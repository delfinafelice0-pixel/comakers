// ═══════════════════════════════════════════════════════════════
//  Edge Function · pull-instagram
//  Trae las métricas orgánicas de Instagram de un mes y las escribe
//  en `reporte`, sin pisar una sola letra de lo que se escribe a mano.
//
//  Deploy:
//    supabase functions deploy pull-instagram
//  Secret (compartido con meta-cuentas):
//    supabase secrets set META_TOKEN="EAAG..."
//
//  Body:  { cliente_id: "uuid", mes?: "2026-08" }
//  El ig_user_id NUNCA llega por el body: sale de cliente_integracion.
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const V = 'v26.0';
const GRAPH = `https://graph.facebook.com/${V}`;
const TZ = 'America/Argentina/Buenos_Aires';

// Un mes de 31 días no entra en una sola llamada (el endpoint corta en
// 30). Partimos en dos ventanas y sumamos.
const MAX_DIAS_VENTANA = 30;

const TIMEOUT_MS = 20_000;
const MAX_REINTENTOS = 3;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────────
//  Errores: objeto, no string. El panel los muestra en un toast,
//  así que `mensaje` tiene que leerse sin saber de APIs.
// ─────────────────────────────────────────────────────────────
class ErrorMeta extends Error {
  code: number | null;
  subcode: number | null;
  mensaje: string;
  reintentable: boolean;

  constructor(code: number | null, subcode: number | null, crudo: string) {
    super(crudo);
    this.code = code;
    this.subcode = subcode;
    const t = traducir(code, subcode, crudo);
    this.mensaje = t.mensaje;
    this.reintentable = t.reintentable;
  }

  aJSON() {
    return { code: this.code, subcode: this.subcode, message: this.mensaje, detalle: this.message };
  }
}

function traducir(code: number | null, subcode: number | null, crudo: string) {
  // 190: el token murió. Reintentar no sirve y además ensucia.
  if (code === 190) {
    return {
      mensaje: subcode === 463
        ? 'El acceso a Instagram venció. Hay que generar un token nuevo en Meta.'
        : 'El acceso a Instagram dejó de ser válido. Hay que generar un token nuevo en Meta.',
      reintentable: false,
    };
  }
  // 368: Meta marcó la cuenta. Se para y se avisa; no se reintenta.
  if (code === 368) {
    return {
      mensaje: 'Meta bloqueó temporalmente esta cuenta por sus políticas. Hay que revisarlo en Business Manager antes de volver a sincronizar.',
      reintentable: false,
    };
  }
  // Rate limits: sí se reintentan, con espera.
  if (code === 17 || code === 32 || code === 613 || code === 4 || code === 80000) {
    return {
      mensaje: 'Meta pidió esperar unos minutos antes de seguir consultando. Probá de nuevo en un rato.',
      reintentable: true,
    };
  }
  if (code === 10 || (code !== null && code >= 200 && code <= 299)) {
    return {
      mensaje: 'El acceso a Instagram no tiene los permisos necesarios para leer estadísticas.',
      reintentable: false,
    };
  }
  if (code === 100) {
    return {
      mensaje: 'Instagram no reconoció una de las métricas pedidas. Puede ser un cambio de la API.',
      reintentable: false,
    };
  }
  if (code === 1 || code === 2) {
    return { mensaje: 'Instagram no está respondiendo bien en este momento.', reintentable: true };
  }
  return { mensaje: 'Instagram devolvió un error inesperado: ' + crudo, reintentable: true };
}

// ─────────────────────────────────────────────────────────────
//  Fetch a Graph: token en header, timeout, backoff con jitter.
// ─────────────────────────────────────────────────────────────
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Diagnóstico de cuota, para mirar si algo se pone raro.
let ultimaCuota: string | null = null;

async function graph(path: string, token: string): Promise<any> {
  let ultimo: ErrorMeta | null = null;

  for (let intento = 0; intento < MAX_REINTENTOS; intento++) {
    if (intento > 0) {
      // 2s, 4s, 8s ± jitter, para no sincronizarnos con nadie.
      const base = 2000 * Math.pow(2, intento - 1);
      await dormir(base + Math.random() * 1000);
    }

    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${GRAPH}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
      clearTimeout(reloj);

      ultimaCuota = res.headers.get('x-business-use-case-usage') ?? ultimaCuota;

      const body = await res.json().catch(() => null);

      if (res.ok && body && !body.error) return body;

      const e = body?.error ?? {};
      ultimo = new ErrorMeta(
        e.code ?? res.status,
        e.error_subcode ?? null,
        e.message ?? `HTTP ${res.status}`,
      );
      if (!ultimo.reintentable) throw ultimo;
    } catch (err) {
      clearTimeout(reloj);
      if (err instanceof ErrorMeta) {
        if (!err.reintentable) throw err;
        ultimo = err;
        continue;
      }
      // Timeout o corte de red: reintentable.
      const esAbort = err instanceof DOMException && err.name === 'AbortError';
      ultimo = new ErrorMeta(
        null,
        null,
        esAbort ? `La consulta a Instagram tardó más de ${TIMEOUT_MS / 1000}s` : String(err),
      );
    }
  }

  throw ultimo ?? new ErrorMeta(null, null, 'No se pudo contactar a Instagram');
}

// ─────────────────────────────────────────────────────────────
//  Fechas: el mes se recorta en Buenos Aires, no en UTC. Si no,
//  el 1° a la madrugada y el último día se contaminan.
// ─────────────────────────────────────────────────────────────
function offsetTz(instante: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(instante))) p[x.type] = x.value;
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return comoUTC - instante;
}

// Instante UTC que corresponde a la medianoche local de y-m-d.
function medianocheLocal(y: number, m: number, d: number, tz: string): number {
  const pared = Date.UTC(y, m - 1, d, 0, 0, 0);
  let t = pared;
  for (let i = 0; i < 2; i++) t = pared - offsetTz(t, tz);
  return t;
}

// Solo para diagnóstico: un unix en hora de Buenos Aires, legible.
function enBA(unixSeg: number): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(unixSeg * 1000));
}

function mesActualEnBA(): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' });
  return f.format(new Date()).slice(0, 7);
}

function mesAnterior(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Ventanas [desde, hasta) en segundos unix, partidas si el mes no entra.
function ventanasDelMes(mes: string): Array<{ since: number; until: number }> {
  const [y, m] = mes.split('-').map(Number);
  const arranque = medianocheLocal(y, m, 1, TZ);
  let fin = medianocheLocal(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, TZ);

  // Si el mes todavía no terminó, no le pedimos el futuro.
  const ahora = Date.now();
  if (fin > ahora) fin = ahora;
  if (fin <= arranque) return [];

  const dia = 86_400_000;
  const ventanas: Array<{ since: number; until: number }> = [];
  let cursor = arranque;
  while (cursor < fin) {
    const tope = Math.min(cursor + MAX_DIAS_VENTANA * dia, fin);
    ventanas.push({ since: Math.floor(cursor / 1000), until: Math.floor(tope / 1000) });
    cursor = tope;
  }
  return ventanas;
}

// ─────────────────────────────────────────────────────────────
//  Lectura de insights
// ─────────────────────────────────────────────────────────────
function valorTotal(body: any, nombre: string): number | null {
  const fila = (body?.data ?? []).find((d: any) => d.name === nombre);
  const v = fila?.total_value?.value;
  return typeof v === 'number' ? v : null;
}

function porBreakdown(body: any, nombre: string): Record<string, number> {
  const fila = (body?.data ?? []).find((d: any) => d.name === nombre);
  const out: Record<string, number> = {};
  for (const b of fila?.total_value?.breakdowns ?? []) {
    for (const r of b.results ?? []) {
      const clave = String((r.dimension_values ?? [])[0] ?? '').toUpperCase();
      if (clave) out[clave] = (out[clave] ?? 0) + (Number(r.value) || 0);
    }
  }
  return out;
}

const sumar = (a: number | null, b: number | null) =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Se completa al final; si algo falla lo usamos para ultimo_error.
  let integracionId: string | null = null;
  let admin: any = null;

  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: { code: null, message: 'Sin sesión' } }, 401);

    let body: any = {};
    try { body = await req.json(); } catch { /* body vacío */ }

    const clienteId = body?.cliente_id ? String(body.cliente_id) : null;
    if (!clienteId) {
      return json({ error: { code: null, message: 'Falta el cliente' } }, 400);
    }
    const mes = body?.mes ? String(body.mes).slice(0, 7) : mesActualEnBA();
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return json({ error: { code: null, message: 'El mes tiene que venir como AAAA-MM' } }, 400);
    }
    const mesFecha = `${mes}-01`;

    // ── 1. Quién llama: RLS decide, no un if nuestro ──────────
    // Este cliente lleva el JWT del usuario, así que la política de
    // `clientes` es la que dice si puede o no. Si no puede, la fila
    // simplemente no vuelve.
    const llamador = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: cliente, error: errCliente } = await llamador
      .from('clientes')
      .select('id, nombre, rep_pauta')
      .eq('id', clienteId)
      .maybeSingle();

    if (errCliente) {
      return json({ error: { code: null, message: 'No se pudo verificar el acceso al cliente' } }, 500);
    }
    if (!cliente) {
      return json({ error: { code: null, message: 'No tenés acceso a este cliente' } }, 403);
    }

    // ── 2. Service role: de acá en adelante, solo para escribir ──
    // (y para leer la integración, que el gate de RLS de arriba ya
    // habilitó al confirmar el acceso al cliente).
    admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: integ } = await admin
      .from('cliente_integracion')
      .select('id, cuenta_id, cuenta_nombre')
      .eq('cliente_id', clienteId)
      .eq('tipo', 'meta_ig')
      .eq('activo', true)
      .maybeSingle();

    if (!integ?.cuenta_id) {
      return json({
        error: {
          code: null,
          message: `${cliente.nombre} todavía no tiene una cuenta de Instagram conectada. Cargala en Configuración.`,
        },
      }, 409);
    }
    integracionId = integ.id;
    const igId = String(integ.cuenta_id);

    const token = Deno.env.get('META_TOKEN');
    if (!token) {
      return json({ error: { code: null, message: 'Falta configurar el acceso a Meta en el servidor.' } }, 500);
    }

    const ventanas = ventanasDelMes(mes);
    if (!ventanas.length) {
      return json({ error: { code: null, message: 'Ese mes todavía no empezó.' } }, 400);
    }

    // ── 3. Las métricas ───────────────────────────────────────
    // `impressions` está deprecada para Instagram desde v22: la
    // reemplaza `views`.
    //
    // ⚠️ ALCANCE — EL DATO DE META ES INTERMITENTE, NO ESTÁ ROTO SIEMPRE.
    // Pedimos `reach` con metric_type=total_value sobre el rango, que
    // es el único modo de que Meta deduplique personas. NO sumamos el
    // reach diario: eso cuenta dos veces a quien vuelve.
    //
    // Medido el 11/09/2026 · Visitando Tandil · tres meses seguidos:
    //   junio  2026:  reach   403  ·  views  1474   → creíble, pasó
    //   julio  2026:  reach  null  ·  views 16107   → descartado
    //   agosto 2026:  reach    56  ·  views  4158   → descartado
    //
    // Agosto se diagnosticó a fondo: ventana de 30 días devolvió
    // total_value = 56, la suma diaria coincidió en 56 y el pico
    // diario fue 6. Los dos métodos dan lo mismo, sin errores ni
    // problemas de paginación: no es cómo lo pedimos ni cómo lo
    // leemos. Y junio demuestra que tampoco es que el endpoint esté
    // muerto: a veces devuelve un número razonable. Falla de a ratos.
    // La propia descripción que devuelve Meta admite que reach "es
    // una estimación y está en desarrollo".
    //
    // Por eso el guardián de abajo no apaga la métrica: la evalúa mes
    // a mes contra las views y descarta solo cuando no cierra. Si
    // apagáramos el alcance del todo, perderíamos los meses buenos.
    //
    // Queda pendiente, para cuando el dato sea confiable: en meses de
    // 31 días el rango se parte en dos ventanas y sumar los dos
    // total_value vuelve a duplicar a quien apareció en las dos
    // mitades. Es un límite del endpoint (no acepta > 30 días).
    const notas: string[] = [];
    const fallos: Record<string, string> = {};

    async function pedir(qs: string, etiqueta: string, v: { since: number; until: number }) {
      try {
        return await graph(`/${igId}/insights?${qs}&since=${v.since}&until=${v.until}`, token);
      } catch (e) {
        if (e instanceof ErrorMeta && (e.code === 190 || e.code === 368)) throw e;
        fallos[etiqueta] = e instanceof ErrorMeta ? e.mensaje : String(e);
        return null;
      }
    }

    let views: number | null = null, reach: number | null = null;
    let likes: number | null = null, comments: number | null = null;
    let saves: number | null = null, shares: number | null = null;
    let replies: number | null = null, reposts: number | null = null;
    const viewsPorTipo: Record<string, number> = {};
    const interPorTipo: Record<string, number> = {};
    let follows: number | null = null, unfollows: number | null = null;

    for (const v of ventanas) {
      // (a) Métricas simples, en una sola llamada.
      const SIMPLES = 'views,reach,likes,comments,saves,shares,replies,reposts';
      const simples = await pedir(
        `metric=${SIMPLES}&period=day&metric_type=total_value`,
        'simples', v,
      );

      // Si una métrica no existe en esta versión, Meta tira #100 y se
      // cae toda la llamada. Reintentamos de a una para no perder el
      // resto por culpa de una sola.
      if (!simples) {
        for (const m of SIMPLES.split(',')) {
          const uno = await pedir(`metric=${m}&period=day&metric_type=total_value`, `simple:${m}`, v);
          if (!uno) continue;
          const val = valorTotal(uno, m);
          if (m === 'views') views = sumar(views, val);
          else if (m === 'reach') reach = sumar(reach, val);
          else if (m === 'likes') likes = sumar(likes, val);
          else if (m === 'comments') comments = sumar(comments, val);
          else if (m === 'saves') saves = sumar(saves, val);
          else if (m === 'shares') shares = sumar(shares, val);
          else if (m === 'replies') replies = sumar(replies, val);
          else if (m === 'reposts') reposts = sumar(reposts, val);
        }
        notas.push('Algunas métricas se pidieron de a una porque la llamada agrupada falló.');
      } else {
        views = sumar(views, valorTotal(simples, 'views'));
        reach = sumar(reach, valorTotal(simples, 'reach'));
        likes = sumar(likes, valorTotal(simples, 'likes'));
        comments = sumar(comments, valorTotal(simples, 'comments'));
        saves = sumar(saves, valorTotal(simples, 'saves'));
        shares = sumar(shares, valorTotal(simples, 'shares'));
        replies = sumar(replies, valorTotal(simples, 'replies'));
        reposts = sumar(reposts, valorTotal(simples, 'reposts'));
      }

      // (b) Views abiertas por tipo de contenido.
      const vTipo = await pedir(
        'metric=views&period=day&metric_type=total_value&breakdown=media_product_type',
        'views_por_tipo', v,
      );
      if (vTipo) for (const [k, n] of Object.entries(porBreakdown(vTipo, 'views'))) {
        viewsPorTipo[k] = (viewsPorTipo[k] ?? 0) + n;
      }

      // (c) Interacciones por tipo, para posts vs reels.
      const iTipo = await pedir(
        'metric=total_interactions&period=day&metric_type=total_value&breakdown=media_product_type',
        'interacciones_por_tipo', v,
      );
      if (iTipo) for (const [k, n] of Object.entries(porBreakdown(iTipo, 'total_interactions'))) {
        interPorTipo[k] = (interPorTipo[k] ?? 0) + n;
      }

      // (d) Seguidores ganados y perdidos.
      const fu = await pedir(
        'metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type',
        'follows', v,
      );
      if (fu) {
        const d = porBreakdown(fu, 'follows_and_unfollows');
        const f = d['FOLLOWER'] ?? d['FOLLOWS'] ?? d['NEW_FOLLOWS'] ?? null;
        const u = d['UNFOLLOWER'] ?? d['UNFOLLOWS'] ?? null;
        if (f !== null) follows = sumar(follows, f);
        if (u !== null) unfollows = sumar(unfollows, u);
      }
    }

    // ═══════════════════════════════════════════════════════════
    //  MODO DIAGNÓSTICO  ·  body { debug: true }
    //  Temporal: pide el reach de cada ventana por separado, de las
    //  dos formas, y devuelve la respuesta cruda de Meta sin tocar
    //  la base. Sacar cuando se entienda de dónde sale el 57.
    // ═══════════════════════════════════════════════════════════
    if (body?.debug === true) {
      const ventanasDiag: unknown[] = [];

      for (const v of ventanas) {
        const e: Record<string, unknown> = {
          since: v.since,
          until: v.until,
          desde_ba: enBA(v.since),
          hasta_ba: enBA(v.until),
          dias_de_span: Math.round((v.until - v.since) / 86400),
        };

        // (a) Como lo pide la función hoy.
        const q1 = `metric=reach&period=day&metric_type=total_value&since=${v.since}&until=${v.until}`;
        const d1: Record<string, unknown> = { url: `${GRAPH}/${igId}/insights?${q1}` };
        try {
          const r = await graph(`/${igId}/insights?${q1}`, token);
          d1.crudo = r;
          d1.lo_que_lee_valorTotal = valorTotal(r, 'reach');
        } catch (err) {
          d1.error = err instanceof ErrorMeta ? err.aJSON() : String(err);
        }
        e.total_value = d1;

        // (b) Serie diaria, solo para ver el orden de magnitud.
        //     Suma personas repetidas: NO sirve como número final.
        const q2 = `metric=reach&period=day&since=${v.since}&until=${v.until}`;
        const d2: Record<string, unknown> = { url: `${GRAPH}/${igId}/insights?${q2}` };
        try {
          const r = await graph(`/${igId}/insights?${q2}`, token);
          const vals = r?.data?.[0]?.values ?? [];
          d2.dias_devueltos = vals.length;
          d2.suma_diaria = vals.reduce((a: number, x: any) => a + (x.value ?? 0), 0);
          d2.pico_diario = vals.reduce((a: number, x: any) => Math.max(a, x.value ?? 0), 0);
          d2.primeros_5 = vals.slice(0, 5);
          d2.ultimos_5 = vals.slice(-5);
          d2.crudo_recortado = { ...r, data: (r?.data ?? []).map((x: any) => ({ ...x, values: undefined })) };
        } catch (err) {
          d2.error = err instanceof ErrorMeta ? err.aJSON() : String(err);
        }
        e.serie_dia = d2;

        ventanasDiag.push(e);
      }

      return json({
        ok: true,
        modo: 'diagnostico — no se escribió nada en la base',
        mes,
        version_api: V,
        reach_que_hubiera_escrito: reach,
        views_org: views,
        metricas_que_fallaron: fallos,
        ventanas: ventanasDiag,
        cuota: ultimaCuota,
      });
    }

    const POST = ['POST', 'CAROUSEL_CONTAINER', 'IMAGE', 'CAROUSEL_ALBUM'];
    const juntar = (src: Record<string, number>, claves: string[]) => {
      const hay = claves.some((k) => k in src);
      return hay ? claves.reduce((a, k) => a + (src[k] ?? 0), 0) : null;
    };

    // ── 3.b Guardián del alcance ──────────────────────────────
    // Meta devuelve un reach roto (ver el bloque de arriba). Antes de
    // escribirlo, lo contrastamos contra las views del mismo mes: si
    // es menos de la décima parte, es inconsistente y no se guarda.
    // Preferimos un hueco visible a un número que nadie puede creer.
    const UMBRAL = 10;
    let alcanceDescartado = false;
    if (reach !== null && views !== null && views > 0 && reach < views / UMBRAL) {
      alcanceDescartado = true;
      fallos['alcance'] =
        `alcance descartado: Meta devolvió un valor inconsistente ` +
        `(reach ${reach} contra ${views} views en el mes)`;
      reach = null;
    }

    // ── 4. La fila. Solo columnas de máquina. ─────────────────
    const fila: Record<string, unknown> = {
      cliente_id: clienteId,
      mes: mesFecha,
      views_org: views,
      views_org_historias: juntar(viewsPorTipo, ['STORY']),
      views_org_posts: juntar(viewsPorTipo, POST),
      views_org_reels: juntar(viewsPorTipo, ['REEL', 'REELS']),
      reach_org: reach,
      likes_org: likes,
      comments_org: comments,
      saves_org: saves,
      shares_org: shares,
      replies_org: replies,
      reposts_org: reposts,
      inter_posts_org: juntar(interPorTipo, POST),
      inter_reels_org: juntar(interPorTipo, ['REEL', 'REELS']),
      follows_mes: follows,
      unfollows_mes: unfollows,
      fuente: 'instagram',
      sincronizado_en: new Date().toISOString(),
    };

    // ── 5. `alcance` solo si el cliente no tiene pauta ────────
    // Con pauta, `alcance` es el consolidado orgánico + paga y lo
    // maneja otro proceso: acá no se toca.
    const previo = await admin
      .from('reporte')
      .select('alcance, reach_org')
      .eq('cliente_id', clienteId)
      .eq('mes', `${mesAnterior(mes)}-01`)
      .maybeSingle();

    if (cliente.rep_pauta === false) {
      // Si el alcance se descartó, las tres van en null a propósito.
      fila.alcance = alcanceDescartado ? null : reach;
      // El único delta que esta función puede calcular honestamente:
      // los otros tres (conversiones, inversión, engagement) salen de
      // pauta, que acá no se lee.
      const ant = previo.data?.alcance ?? previo.data?.reach_org ?? null;
      fila.alcance_delta = (reach !== null && ant)
        ? Math.round(((reach - ant) / ant) * 1000) / 10
        : null;
    }

    // ── 6. Upsert ─────────────────────────────────────────────
    const { error: errUp } = await admin
      .from('reporte')
      .upsert(fila, { onConflict: 'cliente_id,mes' });

    if (errUp) {
      // 42P10 = no existe el índice único que el upsert necesita.
      const falta = String(errUp.code) === '42P10' || /ON CONFLICT/i.test(errUp.message ?? '');
      const msg = falta
        ? 'Falta el índice único (cliente_id, mes) en la tabla reporte. Sin eso no se puede guardar sin duplicar.'
        : 'No se pudo guardar el reporte: ' + (errUp.message ?? 'error de base');
      await admin.from('cliente_integracion')
        .update({ ultimo_error: `${mes} · ${msg}`, ultimo_sync: null })
        .eq('id', integracionId);
      return json({ error: { code: errUp.code ?? null, message: msg } }, 500);
    }

    // ── 7. Dejar rastro de los fallos parciales ───────────────
    // Un pull puede terminar bien y aun así traer menos de lo pedido:
    // una métrica que Meta no devolvió, el alcance descartado por el
    // guardián. Eso viajaba solo en la respuesta y se perdía. Dentro
    // de un mes, mirando un reporte con un hueco, no había forma de
    // saber por qué faltaba. Ahora queda escrito.
    //
    // Codificación, sin columna nueva:
    //   ultimo_sync con fecha + ultimo_error null   → salió completo
    //   ultimo_sync con fecha + ultimo_error texto  → salió con faltantes
    //   ultimo_sync null      + ultimo_error texto  → falló entero
    const faltantes = Object.keys(fallos);
    const resumenFallos = faltantes.length
      ? `${mes} · sincronizó con faltantes · ` +
        faltantes.map((k) => `${k}: ${fallos[k]}`).join(' · ')
      : null;

    await admin.from('cliente_integracion')
      .update({ ultimo_sync: new Date().toISOString(), ultimo_error: resumenFallos })
      .eq('id', integracionId);

    return json({
      ok: true,
      cliente: cliente.nombre,
      mes,
      version_api: V,
      ventanas: ventanas.length,
      escrito: fila,
      alcance_escrito: cliente.rep_pauta === false,
      metricas_que_fallaron: fallos,
      notas,
      cuota: ultimaCuota,
    });
  } catch (e) {
    const err = e instanceof ErrorMeta
      ? e.aJSON()
      : { code: null, subcode: null, message: 'Error inesperado al sincronizar', detalle: String(e) };

    if (admin && integracionId) {
      await admin.from('cliente_integracion')
        .update({ ultimo_error: err.message, ultimo_sync: null })
        .eq('id', integracionId);
    }
    const status = err.code === 190 || err.code === 368 ? 403 : 502;
    return json({ error: err }, status);
  }
});
