// ═══════════════════════════════════════════════════════════════
//  Edge Function · pull-ads
//  Trae los totales de pauta de Meta de un mes y los escribe en las
//  columnas _ads de `reporte`.
//
//  Deploy:
//    supabase functions deploy pull-ads
//  Usa el mismo secret que los otros pulls:
//    META_TOKEN
//
//  Body:  { cliente_id: "uuid", mes?: "2026-08" }
//  La cuenta publicitaria NUNCA llega por el body: sale de
//  cliente_integracion con tipo = 'meta_ads'.
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS, json, graph, ErrorMeta, cuota, V } from '../_shared/meta.ts';
import { mesActualEnBA, TZ } from '../_shared/fechas.ts';

// ─────────────────────────────────────────────────────────────
//  Qué cuenta como "resultado"
//
//  Meta no tiene una métrica "resultados": devuelve un arreglo de
//  acciones y cada campaña optimiza una distinta. Sumar mensajes con
//  clics daría un número sin sentido, así que hay que elegir una.
//
//  Si el cliente tiene `accion_principal` configurada, esa manda. Si
//  no, se prueba esta lista en orden: son las de mensajería, que es
//  lo que optimizan los clientes de hoy. La que se haya usado queda
//  escrita en `reporte.accion_ads`, para que el panel pueda decir
//  "19 conversaciones" y no "19 resultados".
// ─────────────────────────────────────────────────────────────
const ACCIONES_MENSAJES = [
  'onsite_conversion.total_messaging_connection',
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.messaging_first_reply',
];

// Nombre legible de cada acción, para el rótulo del panel.
const ETIQUETA_ACCION: Record<string, string> = {
  'onsite_conversion.total_messaging_connection': 'conversaciones',
  'onsite_conversion.messaging_conversation_started_7d': 'conversaciones iniciadas',
  'onsite_conversion.messaging_first_reply': 'primeras respuestas',
  'link_click': 'clics en el enlace',
  'landing_page_view': 'visitas a la web',
  'lead': 'leads',
  'purchase': 'compras',
  'post_engagement': 'interacciones',
  'video_view': 'reproducciones',
};

const CAMPOS = [
  'spend', 'reach', 'impressions', 'frequency', 'clicks', 'ctr', 'cpm',
  'actions', 'cost_per_action_type', 'account_currency',
].join(',');

// Meta espera fechas YYYY-MM-DD y las interpreta en la zona horaria
// de la cuenta publicitaria. Las cuentas son argentinas, así que
// armamos el rango con el calendario local y no en UTC.
function rangoDelMes(mes: string): { since: string; until: string } | null {
  const [y, m] = mes.split('-').map(Number);
  const hoyStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  const primero = `${mes}-01`;
  // Día 0 del mes siguiente = último día de este mes.
  const ultimoDia = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 0)).getUTCDate();
  let ultimo = `${mes}-${String(ultimoDia).padStart(2, '0')}`;

  // Si el mes está en curso, no le pedimos el futuro.
  if (ultimo > hoyStr) ultimo = hoyStr;
  if (primero > ultimo) return null;
  return { since: primero, until: ultimo };
}

// `actions` y `cost_per_action_type` vienen como arreglos de
// { action_type, value }. Esto busca uno.
function buscarAccion(lista: any, tipo: string): number | null {
  if (!Array.isArray(lista)) return null;
  const f = lista.find((a: any) => a?.action_type === tipo);
  const v = f ? Number(f.value) : NaN;
  return isNaN(v) ? null : v;
}

const num = (v: any) => {
  const n = Number(v);
  return v == null || v === '' || isNaN(n) ? null : n;
};
const ent = (v: any) => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  let integracionId: string | null = null;
  let admin: any = null;

  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: { code: null, message: 'Sin sesión' } }, 401);

    let body: any = {};
    try { body = await req.json(); } catch { /* body vacío */ }

    const clienteId = body?.cliente_id ? String(body.cliente_id) : null;
    if (!clienteId) return json({ error: { code: null, message: 'Falta el cliente' } }, 400);

    const mes = body?.mes ? String(body.mes).slice(0, 7) : mesActualEnBA();
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return json({ error: { code: null, message: 'El mes tiene que venir como AAAA-MM' } }, 400);
    }
    const mesFecha = `${mes}-01`;

    // ── 1. Quién llama: RLS decide ────────────────────────────
    const llamador = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: cliente, error: errCliente } = await llamador
      .from('clientes').select('id, nombre').eq('id', clienteId).maybeSingle();

    if (errCliente) return json({ error: { code: null, message: 'No se pudo verificar el acceso al cliente' } }, 500);
    if (!cliente)   return json({ error: { code: null, message: 'No tenés acceso a este cliente' } }, 403);

    admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── 2. ¿Este cliente reporta pauta? ───────────────────────
    // Si el módulo está apagado, no gastamos cuota de Meta trayendo
    // algo que nadie va a ver. cliente_modulo es la única verdad:
    // clientes.rep_pauta quedó obsoleta.
    const { data: mod } = await admin
      .from('cliente_modulo').select('activo')
      .eq('cliente_id', clienteId).eq('modulo', 'pauta').maybeSingle();

    if (mod && mod.activo === false) {
      return json({
        ok: true, cliente: cliente.nombre, mes,
        omitido: 'El módulo de pauta está apagado para este cliente.',
      });
    }

    // ── 3. La cuenta publicitaria ─────────────────────────────
    const { data: integ } = await admin
      .from('cliente_integracion')
      .select('id, cuenta_id, cuenta_nombre, accion_principal')
      .eq('cliente_id', clienteId).eq('tipo', 'meta_ads').eq('activo', true)
      .maybeSingle();

    if (!integ?.cuenta_id) {
      return json({
        error: {
          code: null,
          message: `${cliente.nombre} no tiene una cuenta publicitaria conectada. Cargala en Configuración.`,
        },
      }, 409);
    }
    integracionId = integ.id;
    // El id de cuenta va con el prefijo act_. Si lo cargaron sin él,
    // lo agregamos: es un error fácil de cometer y molesto de
    // diagnosticar, porque Meta devuelve un 400 genérico.
    const actId = String(integ.cuenta_id).startsWith('act_')
      ? String(integ.cuenta_id)
      : 'act_' + String(integ.cuenta_id);

    const token = Deno.env.get('META_TOKEN');
    if (!token) return json({ error: { code: null, message: 'Falta configurar el acceso a Meta en el servidor.' } }, 500);

    const rango = rangoDelMes(mes);
    if (!rango) return json({ error: { code: null, message: 'Ese mes todavía no empezó.' } }, 400);

    // ── 4. Los insights de la cuenta ──────────────────────────
    // level=account: el total del mes, sin abrir por campaña. El
    // detalle por anuncio es otra etapa.
    const qs = `level=account&fields=${CAMPOS}` +
      `&time_range=${encodeURIComponent(JSON.stringify(rango))}`;

    const res = await graph(`/${actId}/insights?${qs}`, token);
    const fila0 = (res?.data ?? [])[0];

    // Sin filas no es un error: es un mes sin pauta. Se escribe el
    // mes con los totales en null y se deja constancia, en vez de
    // dejar el mes anterior colgado como si fuera el actual.
    const notas: string[] = [];
    if (!fila0) notas.push('Meta no devolvió actividad publicitaria en ese mes.');

    // ── 5. Qué acción es "el resultado" ───────────────────────
    const acciones = fila0?.actions ?? [];
    const costos = fila0?.cost_per_action_type ?? [];

    let accion: string | null = integ.accion_principal || null;
    let resultados: number | null = null;

    if (accion) {
      resultados = buscarAccion(acciones, accion);
      if (resultados === null) {
        notas.push(`La acción configurada (${accion}) no aparece en este mes.`);
      }
    } else {
      for (const cand of ACCIONES_MENSAJES) {
        const v = buscarAccion(acciones, cand);
        if (v !== null) { accion = cand; resultados = v; break; }
      }
      if (accion === null && acciones.length) {
        notas.push('Ninguna acción de mensajería en este mes. Si la cuenta optimiza a otra cosa, configurá accion_principal.');
      }
    }

    const costoResultado = accion ? buscarAccion(costos, accion) : null;

    // ── 6. La fila ────────────────────────────────────────────
    const datos: Record<string, unknown> = {
      inversion_ads:       num(fila0?.spend),
      moneda_ads:          fila0?.account_currency ?? null,
      resultados_ads:      resultados === null ? null : Math.round(resultados),
      accion_ads:          accion,
      costo_resultado_ads: costoResultado,
      reach_ads:           ent(fila0?.reach),
      impresiones_ads:     ent(fila0?.impressions),
      frecuencia_ads:      num(fila0?.frequency),
      clics_ads:           ent(fila0?.clicks),
      ctr_ads:             num(fila0?.ctr),
      cpm_ads:             num(fila0?.cpm),
      ads_sincronizado_en: new Date().toISOString(),
      actualizado_en:      new Date().toISOString(),
    };

    // ── 7. Escribir sin pisar el estado del reporte ───────────
    // Un upsert plano tendría que mandar `estado`, y eso podría
    // devolver a borrador un reporte ya publicado. Por eso se mira
    // primero si la fila existe.
    const { data: previo } = await admin
      .from('reporte').select('id')
      .eq('cliente_id', clienteId).eq('mes', mesFecha).maybeSingle();

    let errEscritura: any = null;
    if (previo?.id) {
      const { error } = await admin.from('reporte').update(datos).eq('id', previo.id);
      errEscritura = error;
    } else {
      const { error } = await admin.from('reporte').insert({
        ...datos, cliente_id: clienteId, mes: mesFecha,
        estado: 'borrador', fuente: 'meta_ads',
      });
      errEscritura = error;
    }

    if (errEscritura) {
      const msg = 'No se pudo guardar la pauta: ' + (errEscritura.message ?? 'error de base');
      await admin.from('cliente_integracion')
        .update({ ultimo_error: `${mes} · ${msg}`, ultimo_sync: null })
        .eq('id', integracionId);
      return json({ error: { code: errEscritura.code ?? null, message: msg } }, 500);
    }

    await admin.from('cliente_integracion')
      .update({
        ultimo_sync: new Date().toISOString(),
        ultimo_error: notas.length ? `${mes} · ${notas.join(' · ')}` : null,
      })
      .eq('id', integracionId);

    return json({
      ok: true,
      cliente: cliente.nombre,
      cuenta: integ.cuenta_nombre || actId,
      mes,
      version_api: V,
      rango,
      accion_contada: accion,
      etiqueta: accion ? (ETIQUETA_ACCION[accion] || 'resultados') : null,
      escrito: datos,
      notas,
      cuota: cuota(),
    });
  } catch (e) {
    const err = e instanceof ErrorMeta
      ? e.aJSON()
      : { code: null, subcode: null, message: 'Error inesperado al traer la pauta', detalle: String(e) };

    if (admin && integracionId) {
      await admin.from('cliente_integracion')
        .update({ ultimo_error: err.message, ultimo_sync: null })
        .eq('id', integracionId);
    }
    const status = err.code === 190 || err.code === 368 ? 403 : 502;
    return json({ error: err }, status);
  }
});
