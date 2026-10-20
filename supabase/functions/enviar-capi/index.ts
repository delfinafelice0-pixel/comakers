// ═══════════════════════════════════════════════════════════════
//  Edge Function · enviar-capi
//
//  Vacía la cola `evento_capi`: agarra los pendientes, los agrupa por
//  dataset de Meta y los manda a la Conversions API de WhatsApp
//  (Click-to-WhatsApp). Marca cada fila como enviada, pendiente (con
//  su motivo) o fallida definitiva, guardando el error completo.
//
//  La DISPARA el cron (ver claude_FUENTE-agendar-enviar-capi.sql), no
//  el insert: así se puede reintentar y agrupar. No la llama el
//  navegador — es 100% service_role.
//
//  Deploy:
//    npx --yes supabase@latest functions deploy enviar-capi \
//      --project-ref ggcstolnadkkqhsqpzql --no-verify-jwt
//
//  Secrets que usa:
//    CAPI_TOKEN                 token de Meta para el CAPI. Si falta, cae
//                               a META_TOKEN (el mismo de los pulls). Se
//                               separa así para que el CAPI use un System
//                               User token durable con el permiso
//                               whatsapp_business_manage_events, sin
//                               depender del token de los pulls ni del
//                               WHATSAPP_TEST_TOKEN temporal de wa-enviar.
//    SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   (los pone Supabase)
//    CAPI_DRY_RUN = '1'         (opcional) arma y loguea el payload
//                               SIN postear a Meta y SIN tocar filas
//
//  ── El permiso todavía no está aprobado ─────────────────────────
//  whatsapp_business_manage_events va en la 2ª ronda de App Review.
//  Hasta entonces el envío real devuelve error de permiso. Eso NO es
//  un bug: se detecta aparte, se loguea con el prefijo
//  [CAPI][PERMISO-PENDIENTE] y la fila queda PENDIENTE (sin quemar
//  intentos), para que salga sola cuando se apruebe. Lo mismo para el
//  dataset sin dar de alta (SIN_DATASET) y el waba_id faltante
//  (SIN_WABA): config pendiente, no error definitivo.
//
//  Payload (verificado contra AWS End User Messaging + doc de Meta):
//    POST {GRAPH}/{dataset_id}/events
//    { "data": [{
//        event_name: 'LeadSubmitted' | 'Purchase',
//        event_time: <unix seg, momento de la clasificación>,
//        action_source: 'business_messaging',
//        messaging_channel: 'whatsapp',
//        event_id: <id de la fila, para que Meta deduplique>,
//        user_data: { whatsapp_business_account_id, ctwa_clid },
//        custom_data: { currency, value }   // solo Purchase
//    }] }
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS, GRAPH, V, json } from '../_shared/meta.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// CAPI_TOKEN si está; si no, el META_TOKEN de los pulls. El CAPI necesita
// el permiso whatsapp_business_manage_events (en App Review), así que lo
// ideal es un System User token durable propio en CAPI_TOKEN.
const TOKEN = Deno.env.get('CAPI_TOKEN') ?? Deno.env.get('META_TOKEN') ?? '';
const DRY_RUN = (Deno.env.get('CAPI_DRY_RUN') ?? '') === '1';

// Topes y tiempos.
const LOTE_MAX = 1000;              // tope duro de Meta por request
const CLAIM_MAX = 500;              // cuántos pendientes agarrar por corrida
const MAX_INTENTOS = 8;             // transitorios: tras esto, error definitivo
const VENTANA_SEG = 7 * 24 * 3600;  // Meta rechaza eventos de > 7 días
const BACKOFF_CONFIG_MIN = 60;      // permiso/dataset/waba: reintento suave (1 h)

type Fila = {
  id: string;
  conversacion_id: string;
  evento: 'LeadSubmitted' | 'Purchase';
  valor: number | null;
  intentos: number;
  creado_en: string;
};

const nowIso = () => new Date().toISOString();
const enMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

// Transitorio: 30s, 60, 120 … tope 1 h.
function backoffSeg(intentos: number): number {
  return Math.min(30 * Math.pow(2, Math.max(0, intentos - 1)), 3600);
}

// Clase del error de Meta, para decidir qué hacer con la fila.
//   'PERMISO'     → whatsapp_business_manage_events / token sin alcance
//   'VALIDACION'  → dato malo del evento (400): terminal, no reintenta
//   'TRANSITORIO' → rate limit / 5xx / red: reintenta con backoff
function clasificar(status: number, code: number | null): 'PERMISO' | 'VALIDACION' | 'TRANSITORIO' {
  // Permiso/alcance del token. 10 = app sin permiso; 200-299 = permisos;
  // 190 = token caído/sin el scope. Todos recuperables con config, no se
  // pierden: se dejan pendientes y se avisa fuerte.
  if (code === 10 || code === 190 || (code !== null && code >= 200 && code <= 299)) return 'PERMISO';
  // Rate limit de Meta.
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80000) return 'TRANSITORIO';
  // 5xx del lado de Meta / gateway.
  if (status >= 500) return 'TRANSITORIO';
  // 429 explícito.
  if (status === 429) return 'TRANSITORIO';
  // 400 y cualquier otro error con cuerpo: validación.
  if (status === 400) return 'VALIDACION';
  // Sin más datos, lo tratamos como transitorio (no quemamos la fila).
  return 'TRANSITORIO';
}

// POST a Graph con el token de agencia. Devuelve {ok, status, body, code}.
async function graphPost(path: string, cuerpo: unknown): Promise<{ ok: boolean; status: number; body: any; code: number | null }> {
  try {
    const res = await fetch(`${GRAPH}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const body = await res.json().catch(() => null);
    const err = body?.error ?? null;
    const code = err?.code ?? null;
    // Un 200 con events_received = 0 es un fracaso encubierto (Meta no
    // tomó nada). Lo tratamos como no-ok para que reintente.
    const okReal = res.ok && !err && (body?.events_received == null || Number(body.events_received) >= 1);
    return { ok: okReal, status: res.status, body, code };
  } catch (e) {
    // Timeout / corte de red: transitorio.
    return { ok: false, status: 0, body: { error: { message: String(e) } }, code: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Gate: solo el cron (que manda el service_role). No hay camino de
  // navegador en esta función.
  if (req.headers.get('Authorization') !== `Bearer ${SERVICE}`) {
    return json({ error: 'no autorizado' }, 401);
  }
  if (!TOKEN) return json({ error: 'Falta el token de Meta (CAPI_TOKEN o META_TOKEN) en el servidor.' }, 500);

  const admin = createClient(URL, SERVICE);
  const resumen: Record<string, number> = {
    agarrados: 0, ok: 0, permiso_pendiente: 0, sin_dataset: 0, sin_waba: 0,
    validacion: 0, vencidos: 0, transitorios: 0,
  };

  // ── 1 ── Agarrar pendientes elegibles ──────────────────────────
  const { data: pend, error: ePend } = await admin
    .from('evento_capi')
    .select('id, conversacion_id, evento, valor, intentos, creado_en')
    .eq('estado', 'pendiente')
    .lte('proximo_intento', nowIso())
    .order('creado_en', { ascending: true })
    .limit(CLAIM_MAX);

  if (ePend) return json({ error: 'No se pudo leer la cola: ' + ePend.message }, 500);
  if (!pend || !pend.length) return json({ ok: true, dry_run: DRY_RUN, resumen, nota: 'nada pendiente' });
  resumen.agarrados = pend.length;

  const filas = pend as Fila[];
  const convIds = [...new Set(filas.map(f => f.conversacion_id))];

  // Conversaciones (para el cliente) y clid (dato de tercero, service_role).
  const [{ data: convs }, { data: pautas }] = await Promise.all([
    admin.from('conversacion').select('id, cliente_id').in('id', convIds),
    admin.from('conversacion_pauta').select('conversacion_id, ctwa_clid').in('conversacion_id', convIds),
  ]);
  const clienteDeConv = new Map<string, string>();
  for (const c of convs ?? []) clienteDeConv.set(c.id, c.cliente_id);
  const clidDeConv = new Map<string, string>();
  for (const p of pautas ?? []) if (p.ctwa_clid) clidDeConv.set(p.conversacion_id, p.ctwa_clid);

  // Config de WhatsApp por cliente (waba_id, dataset_id, moneda). Un
  // cliente puede tener más de un número; lo que importa es el WABA. Si
  // los números activos apuntan a un solo WABA, no hay ambigüedad.
  const clienteIds = [...new Set([...clienteDeConv.values()])];
  const { data: cws } = await admin
    .from('cliente_whatsapp')
    .select('cliente_id, waba_id, dataset_id, moneda, activo')
    .in('cliente_id', clienteIds)
    .eq('activo', true);

  // cliente → { wabas:Set, dataset_id, moneda } (del WABA único si lo hay)
  const cfgDeCliente = new Map<string, { wabas: Set<string>; dataset_id: string | null; moneda: string }>();
  for (const r of cws ?? []) {
    const e = cfgDeCliente.get(r.cliente_id) ?? { wabas: new Set<string>(), dataset_id: null, moneda: 'ARS' };
    if (r.waba_id) e.wabas.add(String(r.waba_id));
    if (r.dataset_id) e.dataset_id = String(r.dataset_id);
    if (r.moneda) e.moneda = String(r.moneda);
    cfgDeCliente.set(r.cliente_id, e);
  }

  // ── 2 ── Clasificar cada fila ──────────────────────────────────
  // Las que están listas para enviar se agrupan por dataset. Las que
  // esperan config/permiso o fallan la validación local se resuelven
  // acá mismo (sin tocar a Meta).
  const nowSeg = Math.floor(Date.now() / 1000);
  type Listo = { fila: Fila; waba: string; dataset: string; evento: any };
  const porDataset = new Map<string, Listo[]>();
  // Para resolver datasets faltantes: waba → filas que lo esperan.
  const esperanDataset = new Map<string, { cliente: string; items: Listo[] }>();

  // Cada decisión se ESCRIBE en el acto, no se difiere al final. Antes se
  // juntaba todo en un array y se escribía recién después de las llamadas
  // a Meta (secciones 3-4): si algo ahí fallaba, se perdían TODAS las
  // marcas de la corrida —incluido un VENCIDO ya decidido— y la fila
  // quedaba pendiente, codigo null, invisible para siempre. Escribir en el
  // momento hace que lo decidido quede, pase lo que pase después.
  const escribir = async (ids: string[], patch: Record<string, unknown>) => {
    if (DRY_RUN || !ids.length) return;
    const { error } = await admin.from('evento_capi').update(patch).in('id', ids);
    if (error) console.log(`[CAPI][ERROR-ESCRITURA] ${error.message} · ids=${ids.join(',')}`);
  };
  const marcarTerminal = (id: string, codigo: string, detalle: string) =>
    escribir([id], { estado: 'error', codigo, detalle, enviado_en: null, actualizado_en: nowIso() });
  const marcarEspera = (id: string, codigo: string, detalle: string) =>
    // Sigue pendiente, sin quemar intentos, reintento suave.
    escribir([id], { codigo, detalle, proximo_intento: enMin(BACKOFF_CONFIG_MIN), actualizado_en: nowIso() });

  for (const f of filas) {
    const clienteId = clienteDeConv.get(f.conversacion_id) ?? null;
    const clid = clidDeConv.get(f.conversacion_id) ?? null;
    const cfg = clienteId ? cfgDeCliente.get(clienteId) : undefined;

    // VENCIDO primero, antes que todo lo demás: un evento de más de 7 días
    // Meta no lo toma nunca, así que no importa que le falte clid o config.
    // Tiene que quedar error/VENCIDO sí o sí, nunca pendiente invisible.
    // (Date.parse por las dudas: si creado_en no parsea, NaN haría que la
    // comparación diera false y el vencido se escaparía.)
    const t = Date.parse(f.creado_en);
    if (!Number.isFinite(t)) { await marcarTerminal(f.id, 'VALIDACION', 'creado_en no parsea: ' + f.creado_en); resumen.validacion++; continue; }
    const evSeg = Math.floor(t / 1000);
    if (nowSeg - evSeg > VENTANA_SEG) { await marcarTerminal(f.id, 'VENCIDO', 'evento de más de 7 días'); resumen.vencidos++; continue; }

    // Resto de validación local terminal (dato del evento, no se arregla con config).
    if (!clid) { await marcarTerminal(f.id, 'VALIDACION', 'sin ctwa_clid'); resumen.validacion++; continue; }
    if (f.evento === 'Purchase' && !(Number(f.valor) > 0)) {
      await marcarTerminal(f.id, 'VALIDACION', 'Purchase sin valor > 0'); resumen.validacion++; continue;
    }

    // Config pendiente (NO terminal): waba o dataset faltantes.
    if (!cfg || cfg.wabas.size === 0) { await marcarEspera(f.id, 'SIN_WABA', 'cliente_whatsapp sin waba_id activo'); resumen.sin_waba++; continue; }
    if (cfg.wabas.size > 1) { await marcarEspera(f.id, 'SIN_WABA', 'más de un WABA activo para el cliente; no se puede elegir dataset'); resumen.sin_waba++; continue; }
    const waba = [...cfg.wabas][0];

    const ev = {
      event_name: f.evento,
      event_time: evSeg,
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      event_id: f.id,
      user_data: { whatsapp_business_account_id: waba, ctwa_clid: clid },
      ...(f.evento === 'Purchase' ? { custom_data: { currency: cfg.moneda || 'ARS', value: Number(f.valor) } } : {}),
    };
    const listo: Listo = { fila: f, waba, dataset: cfg.dataset_id ?? '', evento: ev };

    if (!cfg.dataset_id) {
      const g = esperanDataset.get(waba) ?? { cliente: clienteId!, items: [] };
      g.items.push(listo);
      esperanDataset.set(waba, g);
    } else {
      const arr = porDataset.get(cfg.dataset_id) ?? [];
      arr.push(listo);
      porDataset.set(cfg.dataset_id, arr);
    }
  }

  // ── 3 ── Resolver datasets faltantes (uno por WABA) ────────────
  // POST /{waba_id}/dataset es idempotente: si existe, devuelve el mismo.
  for (const [waba, g] of esperanDataset) {
    try {
      if (DRY_RUN) {
        // En dry-run no tocamos Meta ni las filas: solo contamos las que
        // no se podrían enviar porque el dataset está sin resolver.
        resumen.sin_dataset += g.items.length;
        continue;
      }
      const r = await graphPost(`/${waba}/dataset`, {});
      if (r.ok && r.body?.id) {
        const dataset = String(r.body.id);
        await admin.from('cliente_whatsapp').update({ dataset_id: dataset }).eq('cliente_id', g.cliente).is('dataset_id', null);
        const arr = porDataset.get(dataset) ?? [];
        for (const it of g.items) { it.dataset = dataset; arr.push(it); }
        porDataset.set(dataset, arr);
      } else {
        const clase = clasificar(r.status, r.code);
        const detalle = JSON.stringify(r.body?.error ?? r.body ?? {}).slice(0, 2000);
        if (clase === 'PERMISO') {
          console.log(`[CAPI][PERMISO-PENDIENTE] dataset WABA ${waba}: ${detalle}`);
          for (const it of g.items) { await marcarEspera(it.fila.id, 'PERMISO_PENDIENTE', detalle); resumen.permiso_pendiente++; }
        } else {
          // No se pudo dar de alta el dataset: sigue pendiente como SIN_DATASET.
          console.log(`[CAPI][SIN_DATASET] WABA ${waba} (${clase}): ${detalle}`);
          for (const it of g.items) { await marcarEspera(it.fila.id, 'SIN_DATASET', detalle); resumen.sin_dataset++; }
        }
      }
    } catch (e) {
      // Un fallo resolviendo un WABA no aborta el resto: lo ya decidido
      // quedó escrito; estas filas siguen pendientes para la próxima.
      console.log(`[CAPI][ERROR] resolviendo dataset WABA ${waba}: ${String(e)}`);
    }
  }

  // ── 4 ── Enviar por dataset ────────────────────────────────────
  const dryPayloads: unknown[] = [];

  // Aplica el resultado de enviar un grupo de eventos. Cada decisión se
  // escribe en el acto (ver `escribir`), no se difiere.
  const aplicarResultado = async (items: Listo[], r: { ok: boolean; status: number; body: any; code: number | null }) => {
    if (r.ok) {
      await escribir(items.map(i => i.fila.id), { estado: 'ok', codigo: null, detalle: null, enviado_en: nowIso(), actualizado_en: nowIso() });
      resumen.ok += items.length;
      return;
    }
    const clase = clasificar(r.status, r.code);
    const detalle = JSON.stringify(r.body?.error ?? r.body ?? {}).slice(0, 2000);
    if (clase === 'PERMISO') {
      console.log(`[CAPI][PERMISO-PENDIENTE] ${items.length} evento(s): ${detalle}`);
      for (const it of items) await marcarEspera(it.fila.id, 'PERMISO_PENDIENTE', detalle);
      resumen.permiso_pendiente += items.length;
    } else if (clase === 'VALIDACION') {
      // Meta rechaza el lote entero si UN evento es inválido. Si el grupo
      // tiene más de uno, lo mandamos de a uno para aislar al malo y no
      // arrastrar a los sanos a 'error'. (Lo hace el llamador; acá, con
      // un solo item, es terminal.)
      for (const it of items) await marcarTerminal(it.fila.id, 'VALIDACION', detalle);
      resumen.validacion += items.length;
    } else {
      for (const it of items) {
        const intentos = it.fila.intentos + 1;
        if (intentos >= MAX_INTENTOS) {
          await escribir([it.fila.id], { estado: 'error', codigo: 'TRANSITORIO', detalle: `agotó ${MAX_INTENTOS} intentos · ${detalle}`, intentos, actualizado_en: nowIso() });
        } else {
          await escribir([it.fila.id], { codigo: 'TRANSITORIO', detalle, intentos, proximo_intento: new Date(Date.now() + backoffSeg(intentos) * 1000).toISOString(), actualizado_en: nowIso() });
          resumen.transitorios++;
        }
      }
    }
  };

  for (const [dataset, items] of porDataset) {
    // Partir en lotes de a LOTE_MAX.
    for (let i = 0; i < items.length; i += LOTE_MAX) {
      const grupo = items.slice(i, i + LOTE_MAX);
      const payload = { data: grupo.map(g => g.evento) };

      if (DRY_RUN) {
        console.log(`[CAPI][DRY-RUN] dataset ${dataset} · ${grupo.length} evento(s):\n${JSON.stringify(payload, null, 2)}`);
        dryPayloads.push({ dataset, payload });
        continue;   // en dry-run no tocamos ni Meta ni las filas
      }

      try {
        const r = await graphPost(`/${dataset}/events`, payload);
        // Validación con lote > 1: reintentar de a uno para aislar al malo.
        if (!r.ok && grupo.length > 1 && clasificar(r.status, r.code) === 'VALIDACION') {
          console.log(`[CAPI][VALIDACION] lote de ${grupo.length} rechazado; reintento individual para aislar`);
          for (const it of grupo) {
            const ri = await graphPost(`/${dataset}/events`, { data: [it.evento] });
            await aplicarResultado([it], ri);
          }
        } else {
          await aplicarResultado(grupo, r);
        }
      } catch (e) {
        // Un fallo en un dataset no aborta a los demás.
        console.log(`[CAPI][ERROR] enviando al dataset ${dataset}: ${String(e)}`);
      }
    }
  }

  return json({ ok: true, dry_run: DRY_RUN, version_api: V, resumen, ...(DRY_RUN ? { payloads: dryPayloads } : {}) });
});
