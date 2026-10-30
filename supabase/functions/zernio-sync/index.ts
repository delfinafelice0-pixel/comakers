// ═══════════════════════════════════════════════════════════════
//  Edge Function · zernio-sync
//  Ingesta bajo demanda: lista las conversaciones de WhatsApp de Zernio
//  dentro de la ventana since_days y las upsertea en zernio_conversacion.
//  Por defecto entran TODAS (v1.1); las cuentas con zernio_cuenta.solo_pauta
//  = true traen solo las de anuncios (CTWA, v1.2). Los ctwa_* se llenan
//  cuando existen; es_pauta se calcula sola en la base.
//
//  Aislado del camino Meta: no toca evento_capi ni nada sin prefijo
//  zernio_. La ZERNIO_API_KEY vive solo acá (secret de Supabase).
//
//  Deploy:
//    npx --yes supabase@latest functions deploy zernio-sync \
//      --project-ref ggcstolnadkkqhsqpzql --no-verify-jwt
//  Secret: ZERNIO_API_KEY
//
//  Auth: MISMO esquema que crm.html para llamar functions. El navegador
//  manda apikey=publishable, Authorization=Bearer anon-legacy (solo para
//  pasar el gateway) y x-user-token=token de sesión ES256. Acá se valida
//  el usuario con getUser(publishable).
//
//  Autorización vs escritura (v1.3):
//   · Con el TOKEN del usuario se lee qué zernio_cuenta puede ver (la RLS
//     decide: equipo = las de su agencia + las de prueba; cliente = solo
//     las suyas). Esa lista es la ÚNICA autorizada.
//   · Con SERVICE_ROLE se hacen los upserts, solo sobre esas cuentas. Hace
//     falta porque si un cliente upserteara con su token, el guardián de
//     columnas (migración crm-05) le preservaría los campos de Zernio y no
//     podría refrescar lo existente (p. ej. un ctwa_clid que llega tarde).
//     El guardián deja pasar a service_role entero; sigue limitando solo
//     al navegador del cliente (estado/valor/moneda).
//   · Sin sesión válida → 401 antes de tocar Zernio. Nunca se sincroniza
//     una cuenta que el usuario no ve (la lista sale de su propia RLS).
//
//  Recibe: { zernio_account_id?: string, since_days?: number }  (default 7)
//  Devuelve: { ok: true, synced: <int> } | { ok: false, error: <string> }
//
//  ── Listado de Zernio (confirmado en docs.zernio.com) ───────────
//    GET https://zernio.com/api/v1/inbox/conversations
//    Auth: Authorization: Bearer <ZERNIO_API_KEY>
//    Params: platform=whatsapp, folder=inbox, sortOrder=desc,
//            limit (1..100), cursor (paginación por cursor), accountId.
//    La API NO tiene filtro "since", así que since_days se corta del
//    lado nuestro por updatedTime (viene ordenado desc, así que al primer
//    item más viejo que el corte se deja de paginar esa cuenta).
//    Diferencias con el spec: el id de conversación es `id` (no `_id`),
//    no hay `phone` suelto (uso whatsappUsername → participantId), y el
//    timestamp es `updatedTime`.
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const PUBLISHABLE = 'sb_publishable_XQsl345-6ALOLuHksEpeJA_7hxfr9LO';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ZERNIO_BASE = 'https://zernio.com/api/v1';
const ZERNIO_API_KEY = Deno.env.get('ZERNIO_API_KEY') ?? '';

const MAX_PAGES = 50;   // tope de seguridad por cuenta (50 × 100 = 5000)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!ZERNIO_API_KEY) return json({ ok: false, error: 'Falta ZERNIO_API_KEY en el servidor.' }, 500);
  if (!SERVICE_ROLE) return json({ ok: false, error: 'Falta SUPABASE_SERVICE_ROLE_KEY en el servidor.' }, 500);

  // ── Auth: validar la sesión del front (x-user-token) ───────────
  const userToken = (req.headers.get('x-user-token') ?? '').trim();
  if (!userToken) return json({ ok: false, error: 'Sin sesión' }, 401);
  const authClient = createClient(SB_URL, PUBLISHABLE);
  const { data: { user }, error: eUser } = await authClient.auth.getUser(userToken);
  if (eUser || !user) return json({ ok: false, error: 'Sesión inválida' }, 401);
  // Lector con el token del usuario: la RLS decide qué cuentas puede ver.
  // Esa lista es la única autorizada para sincronizar.
  const db = createClient(SB_URL, PUBLISHABLE, { global: { headers: { Authorization: 'Bearer ' + userToken } } });
  // Escritor con service_role: hace los upserts, solo sobre esas cuentas.
  const dbSvc = createClient(SB_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let body: any = {};
  try { body = await req.json(); } catch { /* body vacío */ }

  const sinceDays = Number(body?.since_days) > 0 ? Number(body.since_days) : 7;
  const cutoff = Date.now() - sinceDays * 24 * 3600 * 1000;

  // ── Cuentas a sincronizar (solo activas) ───────────────────────
  let q = db.from('zernio_cuenta').select('zernio_account_id, solo_pauta').eq('activa', true);
  if (body?.zernio_account_id) q = q.eq('zernio_account_id', String(body.zernio_account_id));
  const { data: cuentas, error: eCuentas } = await q;
  if (eCuentas) return json({ ok: false, error: 'No se pudieron leer las cuentas: ' + eCuentas.message }, 500);
  if (!cuentas || !cuentas.length) return json({ ok: true, synced: 0, nota: 'no hay cuentas activas' });

  let synced = 0;

  for (const cta of cuentas) {
    const accountId = String(cta.zernio_account_id);
    // v1.2: cuenta con solo_pauta = true → solo se ingestan las que traen
    // datos de referral CTWA (como el filtro de v1). El resto, todas.
    const soloPauta = !!cta.solo_pauta;
    let cursor: string | null = null;

    for (let pagina = 0; pagina < MAX_PAGES; pagina++) {
      const qs = new URLSearchParams({
        platform: 'whatsapp', folder: 'inbox', sortOrder: 'desc', limit: '100', accountId,
      });
      if (cursor) qs.set('cursor', cursor);

      let r: Response;
      try {
        r = await fetch(`${ZERNIO_BASE}/inbox/conversations?${qs.toString()}`, {
          headers: { Authorization: 'Bearer ' + ZERNIO_API_KEY },
        });
      } catch (e) {
        return json({ ok: false, error: 'No se pudo contactar a Zernio: ' + String(e) }, 502);
      }
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return json({ ok: false, error: `Zernio listado HTTP ${r.status}: ${txt.slice(0, 500)}` }, r.status === 401 || r.status === 403 ? 502 : 502);
      }
      const j = await r.json().catch(() => null);
      const items: any[] = j?.data ?? [];

      const upserts: Record<string, unknown>[] = [];
      let topeViejo = false;
      for (const it of items) {
        const upd = Date.parse(it?.updatedTime ?? '');
        // Viene ordenado desc por updatedTime: al primer item más viejo
        // que el corte, dejamos de mirar esta cuenta.
        if (Number.isFinite(upd) && upd < cutoff) { topeViejo = true; break; }

        // v1.1: por defecto entran TODAS las conversaciones de WhatsApp
        // de la ventana; los ctwa_* se llenan cuando existen (es_pauta se
        // calcula sola en la base). La ventana since_days evita traer los
        // ~6 meses que Zernio importa en coexistencia.
        const md = it?.metadata ?? {};

        // v1.2: en cuentas solo_pauta, se filtra por CTWA (clid o source_id),
        // como en v1. Si una no-pauta recibe el clid más tarde, en la sync
        // siguiente ya pasa el filtro y entra normal.
        if (soloPauta && !md.ctwa_clid && !md.ctwa_source_id) continue;

        upserts.push({
          zernio_account_id: accountId,
          conversation_id: String(it?.id ?? ''),
          phone_e164: digitos(it?.whatsappUsername ?? it?.participantId) || null,
          nombre: it?.participantName ?? null,
          ctwa_clid: md.ctwa_clid ?? null,
          ctwa_source_id: md.ctwa_source_id ?? null,
          ctwa_source_url: md.ctwa_source_url ?? null,
          ctwa_headline: md.ctwa_headline ?? null,
          ctwa_source_type: md.ctwa_source_type ?? null,
          ctwa_captured_at: md.ctwa_captured_at ?? null,
          primer_mensaje: typeof it?.lastMessage === 'string' ? it.lastMessage : null,
          ultimo_mensaje_at: it?.updatedTime ?? null,
          updated_at: new Date().toISOString(),
        });
      }

      if (upserts.length) {
        // ON CONFLICT (zernio_account_id, conversation_id): el payload NO
        // incluye `estado`, así que al actualizar una fila existente el
        // estado (clasificación humana) queda intacto. En filas nuevas,
        // estado toma su default 'nuevo'.
        const { error: eUp } = await dbSvc
          .from('zernio_conversacion')
          .upsert(upserts, { onConflict: 'zernio_account_id,conversation_id' });
        if (eUp) return json({ ok: false, error: 'No se pudo guardar: ' + eUp.message }, 500);
        synced += upserts.length;
      }

      cursor = j?.pagination?.nextCursor ?? null;
      const hayMas = !!j?.pagination?.hasMore;
      if (topeViejo || !hayMas || !cursor) break;
    }
  }

  return json({ ok: true, synced });
});
