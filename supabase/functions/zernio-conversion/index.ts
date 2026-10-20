// ═══════════════════════════════════════════════════════════════
//  Edge Function · zernio-conversion
//  Clasifica una conversación (lead/venta) y manda el evento a Meta vía
//  Zernio, SINCRÓNICO (sin cola, sin pg_cron). Loguea cada envío en
//  zernio_conversion (auditoría propia; el feed de Zernio retiene ~30d).
//
//  Aislado del camino Meta: no toca evento_capi. La ZERNIO_API_KEY vive
//  solo acá (secret de Supabase).
//
//  Deploy:
//    npx --yes supabase@latest functions deploy zernio-conversion \
//      --project-ref ggcstolnadkkqhsqpzql --no-verify-jwt
//  Secret: ZERNIO_API_KEY  (opcional: ZERNIO_TEST_CODE para test events)
//
//  Auth: mismo esquema que crm.html (x-user-token validado con
//  getUser(publishable); llamador con el token del usuario → RLS
//  es_equipo decide). No usa service_role.
//
//  Recibe: { conversacion_id: uuid, event_name: 'LeadSubmitted'|'Purchase',
//            value?: number, currency?: string, test?: boolean|string }
//  Devuelve: { ok, estado_envio: 'enviado'|'fallido'|'sin_clid',
//              trace_id?, events_received?, events_failed?, error? }
//
//  ⚠️ El endpoint de envío (POST /v1/whatsapp/conversions) NO se pudo
//  confirmar en docs.zernio.com (404 al momento de escribir esto): se
//  implementa AL CONTRATO DEL SPEC. El base URL (https://zernio.com/api/v1)
//  y el auth Bearer sí están confirmados por el listado. Si Zernio
//  cambió el path/campos, se ajusta acá en un solo lugar.
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const PUBLISHABLE = 'sb_publishable_XQsl345-6ALOLuHksEpeJA_7hxfr9LO';
const ZERNIO_BASE = 'https://zernio.com/api/v1';
const ZERNIO_API_KEY = Deno.env.get('ZERNIO_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!ZERNIO_API_KEY) return json({ ok: false, error: 'Falta ZERNIO_API_KEY en el servidor.' }, 500);

  // ── Auth (x-user-token → RLS es_equipo) ────────────────────────
  const userToken = (req.headers.get('x-user-token') ?? '').trim();
  if (!userToken) return json({ ok: false, error: 'Sin sesión' }, 401);
  const authClient = createClient(SB_URL, PUBLISHABLE);
  const { data: { user }, error: eUser } = await authClient.auth.getUser(userToken);
  if (eUser || !user) return json({ ok: false, error: 'Sesión inválida' }, 401);
  const db = createClient(SB_URL, PUBLISHABLE, { global: { headers: { Authorization: 'Bearer ' + userToken } } });

  let body: any = {};
  try { body = await req.json(); } catch { /* vacío */ }

  const conversacionId = body?.conversacion_id ? String(body.conversacion_id) : null;
  const eventName = body?.event_name;
  if (!conversacionId) return json({ ok: false, error: 'Falta conversacion_id' }, 400);
  if (eventName !== 'LeadSubmitted' && eventName !== 'Purchase') {
    return json({ ok: false, error: 'event_name tiene que ser LeadSubmitted o Purchase' }, 400);
  }
  const value = body?.value != null && body.value !== '' ? Number(body.value) : null;
  const currency = body?.currency ? String(body.currency) : null;
  if (eventName === 'Purchase' && !(Number(value) > 0)) {
    return json({ ok: false, error: 'Una venta necesita un monto mayor a 0.' }, 400);
  }
  // test: string = código directo; true = usa ZERNIO_TEST_CODE si está.
  const testCode = body?.test
    ? (typeof body.test === 'string' ? body.test : (Deno.env.get('ZERNIO_TEST_CODE') || null))
    : null;

  // ── La conversación (RLS: solo si el usuario es equipo) ─────────
  const { data: conv, error: eConv } = await db
    .from('zernio_conversacion')
    .select('id, zernio_account_id, conversation_id, ctwa_clid')
    .eq('id', conversacionId)
    .maybeSingle();
  if (eConv) return json({ ok: false, error: 'No se pudo leer la conversación: ' + eConv.message }, 500);
  if (!conv) return json({ ok: false, estado_envio: 'fallido', code: 'no_encontrada', error: 'Conversación inexistente.' }, 404);

  const eventId = 'zpuente:' + conv.conversation_id + ':' + eventName;

  const logear = (patch: Record<string, unknown>) =>
    db.from('zernio_conversion').upsert({
      conversacion_id: conv.id,
      zernio_account_id: conv.zernio_account_id,
      conversation_id: conv.conversation_id,
      event_name: eventName,
      event_id: eventId,
      value, currency, test_code: testCode,
      ...patch,
    }, { onConflict: 'event_id' });

  // ── Sin clid: no se manda nada, se deja constancia ─────────────
  if (!conv.ctwa_clid) {
    await logear({ estado_envio: 'sin_clid', error: { message: 'sin ctwa_clid: todavía no se puede atribuir' } });
    return json({ ok: false, estado_envio: 'sin_clid', code: 'sin_clid', error: 'Esta conversación todavía no tiene clid; sincronizá más tarde.' });
  }

  // ── Enviar a Meta vía Zernio ───────────────────────────────────
  const reqBody: Record<string, unknown> = {
    accountId: conv.zernio_account_id,
    conversationId: conv.conversation_id,
    eventName,
    eventId,
  };
  if (value != null && Number.isFinite(value)) reqBody.value = value;
  if (currency) reqBody.currency = currency;
  if (testCode) reqBody.testCode = testCode;

  let r: Response;
  try {
    r = await fetch(`${ZERNIO_BASE}/whatsapp/conversions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + ZERNIO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });
  } catch (e) {
    await logear({ estado_envio: 'fallido', error: { message: 'No se pudo contactar a Zernio: ' + String(e) } });
    return json({ ok: false, estado_envio: 'fallido', error: 'No se pudo contactar a Zernio.' }, 502);
  }

  const j = await r.json().catch(() => null);
  const recibidos = Number(j?.eventsReceived ?? 0);
  const fallidos = Number(j?.eventsFailed ?? 0);
  const trace = j?.fbtrace_id ?? j?.traceId ?? j?.trace_id ?? null;
  const enviado = r.ok && recibidos >= 1 && fallidos === 0;

  // Error legible para los casos que el spec pide mapear.
  let errMsg: string | null = null;
  if (!enviado) {
    if (r.status === 422) errMsg = 'Zernio rechazó el evento (422): falta el clid o el dataset del WABA no está provisionado.';
    else if (r.status === 404) errMsg = 'Zernio no encontró la conversación (404).';
    else if (r.status === 401 || r.status === 403) errMsg = 'Zernio rechazó la credencial (revisar ZERNIO_API_KEY).';
    else errMsg = `Zernio devolvió un error (HTTP ${r.status}).`;
  }

  await logear({
    estado_envio: enviado ? 'enviado' : 'fallido',
    events_received: Number.isFinite(recibidos) ? recibidos : null,
    events_failed: Number.isFinite(fallidos) ? fallidos : null,
    trace_id: trace,
    error: enviado ? null : (j?.failures ?? j ?? { message: errMsg }),
  });

  // Solo si salió, se clasifica la conversación.
  if (enviado) {
    const nuevoEstado = eventName === 'Purchase' ? 'venta' : 'lead';
    const { error: eUpd } = await db.from('zernio_conversacion')
      .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
      .eq('id', conv.id);
    if (eUpd) {
      // El evento ya se mandó y quedó logueado; avisamos que el estado no se guardó.
      return json({ ok: true, estado_envio: 'enviado', trace_id: trace, events_received: recibidos, events_failed: fallidos, error: 'El evento se envió, pero no se pudo actualizar el estado: ' + eUpd.message });
    }
  }

  return json({
    ok: enviado,
    estado_envio: enviado ? 'enviado' : 'fallido',
    trace_id: trace,
    events_received: Number.isFinite(recibidos) ? recibidos : undefined,
    events_failed: Number.isFinite(fallidos) ? fallidos : undefined,
    error: errMsg ?? undefined,
  });
});
