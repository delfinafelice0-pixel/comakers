// ═══════════════════════════════════════════════════════════════
//  Edge Function · zernio-connect-link
//  Genera el link hospedado de Zernio para que un cliente conecte su
//  WhatsApp a distancia (coexistencia). Crea/reusa el perfil del cliente
//  en Zernio y pide la URL de conexión co-brandeada.
//
//  NO escribe en la base. El accountId del cliente se agrega a mano a
//  zernio_cuenta después de que conecta.
//
//  Aislado del camino Meta. La ZERNIO_API_KEY vive solo acá (secret).
//
//  Deploy:
//    npx --yes supabase@latest functions deploy zernio-connect-link \
//      --project-ref ggcstolnadkkqhsqpzql --no-verify-jwt
//  Secret: ZERNIO_API_KEY
//
//  Auth: mismo esquema que crm.html (x-user-token → getUser(publishable)),
//  MÁS gate de equipo a mano (tipo='agencia'/super_admin) porque esta
//  function no toca la base y la RLS no la cubre. Sin token → 401; token
//  válido pero no-equipo → 403. Nada llega a Zernio en esos casos.
//
//  Recibe: { cliente: string }  (1..60, trim)
//  Devuelve: { ok:true, url, profile_id, expira_at } | { ok:false, error }
//
//  ── Flujo (confirmado contra la doc de Zernio) ──────────────────
//   1. POST /v1/profiles { name }  → 201 trae profile._id.
//      409 (nombre ya existe) → details.existingProfileId (se reusa, así
//      regenerar un link del mismo cliente usa su mismo perfil).
//   2. GET /v1/connect/whatsapp con profileId, redirect_url, onboarding,
//      signup=hosted, brandName, primaryColor, language → trae authUrl.
//      (URLSearchParams encodea solo: primaryColor '#FF82FF' → %23FF82FF.)
//   El link hospedado vive 60 min.
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const PUBLISHABLE = 'sb_publishable_XQsl345-6ALOLuHksEpeJA_7hxfr9LO';
const ZERNIO_BASE = 'https://zernio.com/api/v1';
const ZERNIO_API_KEY = Deno.env.get('ZERNIO_API_KEY') ?? '';
const REDIRECT_URL = 'https://comakers.com.ar/puente-conectado.html';
const VENCE_MIN = 60;   // el link hospedado de Zernio vive 60 minutos

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const zAuth = { Authorization: 'Bearer ' + ZERNIO_API_KEY };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!ZERNIO_API_KEY) return json({ ok: false, error: 'Falta ZERNIO_API_KEY en el servidor.' }, 500);

  // ── Auth (x-user-token → RLS es_equipo) ────────────────────────
  const userToken = (req.headers.get('x-user-token') ?? '').trim();
  if (!userToken) return json({ ok: false, error: 'Sin sesión' }, 401);
  const authClient = createClient(SB_URL, PUBLISHABLE);
  const { data: { user }, error: eUser } = await authClient.auth.getUser(userToken);
  if (eUser || !user) return json({ ok: false, error: 'Sesión inválida' }, 401);

  // Gate de EQUIPO, a mano: esta function NO toca la base, así que la RLS
  // (es_equipo) no la cubre como a zernio-sync/zernio-conversion. Sin esto,
  // cualquier usuario logueado —incluido un cliente— podría crear perfiles
  // y quemar links/plan en Zernio. Mismo chequeo que crm.html/puente.html:
  // tipo='agencia' o super_admin, leyendo su propia fila de profiles (RLS
  // deja al usuario leerse a sí mismo). Va ANTES de cualquier llamada a Zernio.
  const db = createClient(SB_URL, PUBLISHABLE, { global: { headers: { Authorization: 'Bearer ' + userToken } } });
  const { data: perfil, error: ePerfil } = await db
    .from('profiles').select('tipo, super_admin').eq('id', user.id).single();
  if (ePerfil || !perfil || !(perfil.tipo === 'agencia' || perfil.super_admin)) {
    return json({ ok: false, error: 'Solo el equipo puede generar links de conexión.' }, 403);
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const cliente = String(body?.cliente ?? '').trim();
  if (cliente.length < 1 || cliente.length > 60) {
    return json({ ok: false, error: 'El nombre del cliente tiene que tener entre 1 y 60 caracteres.' }, 400);
  }

  const pago402 = 'Zernio pide un medio de pago o se alcanzó el límite del plan.';

  // ── 1. Perfil del cliente en Zernio (crear o reusar) ───────────
  let profileId: string | null = null;
  try {
    const rp = await fetch(`${ZERNIO_BASE}/profiles`, {
      method: 'POST',
      headers: { ...zAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: cliente }),
    });
    const jp = await rp.json().catch(() => null);
    if (rp.status === 201) {
      profileId = jp?.profile?._id ?? null;
    } else if (rp.status === 409) {
      // Nombre ya existe: reusamos el perfil que ya está.
      profileId = jp?.details?.existingProfileId ?? null;
    } else if (rp.status === 402) {
      return json({ ok: false, error: pago402 }, 402);
    } else {
      return json({ ok: false, error: `Zernio no pudo crear el perfil (HTTP ${rp.status}).` }, 502);
    }
  } catch (e) {
    return json({ ok: false, error: 'No se pudo contactar a Zernio: ' + String(e) }, 502);
  }
  if (!profileId) return json({ ok: false, error: 'Zernio no devolvió el perfil del cliente.' }, 502);

  // ── 2. Link hospedado ──────────────────────────────────────────
  // URLSearchParams encodea solo (primaryColor '#FF82FF' → %23FF82FF,
  // redirect_url → %3A%2F%2F…). Los valores/nombres están confirmados.
  const qs = new URLSearchParams({
    profileId,
    redirect_url: REDIRECT_URL,
    onboarding: 'business_app',   // coexistencia: el número sigue en la app del cliente
    signup: 'hosted',
    brandName: 'CoMakers',
    primaryColor: '#FF82FF',
    language: 'es',
  });

  let authUrl: string | null = null;
  try {
    const rc = await fetch(`${ZERNIO_BASE}/connect/whatsapp?${qs.toString()}`, { headers: zAuth });
    const jc = await rc.json().catch(() => null);
    if (rc.status === 402) return json({ ok: false, error: pago402 }, 402);
    if (!rc.ok) {
      const det = jc?.error || jc?.code || `HTTP ${rc.status}`;
      return json({ ok: false, error: 'Zernio no devolvió el link: ' + det }, 502);
    }
    authUrl = jc?.authUrl ?? null;
  } catch (e) {
    return json({ ok: false, error: 'No se pudo contactar a Zernio: ' + String(e) }, 502);
  }
  if (!authUrl) return json({ ok: false, error: 'Zernio no devolvió authUrl.' }, 502);

  const expira_at = new Date(Date.now() + VENCE_MIN * 60000).toISOString();
  return json({ ok: true, url: authUrl, profile_id: profileId, expira_at });
});
