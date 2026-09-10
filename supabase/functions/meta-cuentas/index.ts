// ═══════════════════════════════════════════════════════════════
//  Edge Function · meta-cuentas
//  "¿A qué cuentas de Meta llega mi token?"
//
//  Es el primer paso, antes de traer un solo número: devuelve las
//  Páginas de Facebook que ve el token, qué cuenta de Instagram
//  cuelga de cada una (con su ID, que es el que necesitás), y las
//  cuentas publicitarias. Además te dice qué permisos tiene el token
//  y cuándo vence — que es lo que vas a querer mirar el día que esto
//  deje de andar.
//
//  Deploy:
//    supabase functions deploy meta-cuentas
//  Secret (una sola vez):
//    supabase secrets set META_TOKEN="EAAG..."
//
//  ⚠️ Esta función NUNCA devuelve el token, ni los access_token de
//  cada Página (por eso no los pido en `fields`). Devuelve solo IDs
//  y nombres, que sin el token no sirven para nada.
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Fijamos la versión a mano. Nunca "la última": Meta rompe cosas
// entre versiones y preferís enterarte cuando vos decidís subir.
const V = 'v26.0';
const GRAPH = `https://graph.facebook.com/${V}`;

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

// Llama a Graph y devuelve el error de Meta tal cual si falla.
// El mensaje de Meta es específico ("#200 permiso faltante",
// "#100 campo inválido") y es lo único que te va a servir.
async function graph(path: string, token: string) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`);
  const body = await res.json().catch(() => null);
  if (!res.ok || (body && body.error)) {
    const e = body?.error ?? {};
    throw new Error(`Meta ${e.code ?? res.status}: ${e.message ?? 'error sin mensaje'}`);
  }
  return body;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // ── 1. ¿Quién llama? ──────────────────────────────────────
    // Sin esto, cualquiera con la anon key (que está en el HTML)
    // podría listar las cuentas de Meta de tus clientes.
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'Sin sesión' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: u, error: uErr } = await admin.auth.getUser(auth.replace('Bearer ', ''));
    if (uErr || !u?.user) return json({ error: 'Sesión inválida' }, 401);

    const { data: perfil } = await admin
      .from('profiles')
      .select('tipo, super_admin, activo')
      .eq('id', u.user.id)
      .maybeSingle();

    const esAgencia = perfil && perfil.activo !== false &&
      (perfil.tipo === 'agencia' || perfil.super_admin === true);
    if (!esAgencia) return json({ error: 'Solo la agencia puede ver las cuentas de Meta' }, 403);

    // ── 2. El token ───────────────────────────────────────────
    const token = Deno.env.get('META_TOKEN');
    if (!token) {
      return json({ error: 'Falta el secret META_TOKEN. Corré: supabase secrets set META_TOKEN="..."' }, 500);
    }

    // ── 3. Salud del token: permisos y vencimiento ────────────
    // Un System User token no vence (expires_at = 0). Si acá ves una
    // fecha, generaste un token de usuario y en 60 días se muere.
    let salud: Record<string, unknown> = {};
    try {
      const dbg = await graph(`/debug_token?input_token=${encodeURIComponent(token)}`, token);
      const d = dbg?.data ?? {};
      salud = {
        valido: d.is_valid === true,
        tipo: d.type ?? null,
        app_id: d.app_id ?? null,
        vence: !d.expires_at ? 'nunca (System User)' : new Date(d.expires_at * 1000).toISOString(),
        permisos: d.scopes ?? [],
      };
    } catch (e) {
      salud = { error: String(e instanceof Error ? e.message : e) };
    }

    // ── 4. Páginas + la cuenta de IG de cada una ──────────────
    // OJO: `instagram_business_account` viene null si la cuenta de
    // Instagram no es Business/Creator, o si no está vinculada a la
    // Página. Es el motivo nº1 por el que esto "no anda".
    const pages = await graph(
      '/me/accounts?limit=100&fields=id,name,instagram_business_account{id,username,name,followers_count}',
      token,
    );

    const paginas = (pages?.data ?? []).map((p: any) => ({
      page_id: p.id,
      pagina: p.name,
      instagram: p.instagram_business_account
        ? {
            // ⬇️ ESTE es el `cuenta_id` que va en cliente_integracion (tipo 'meta_ig')
            ig_user_id: p.instagram_business_account.id,
            usuario: p.instagram_business_account.username ?? null,
            nombre: p.instagram_business_account.name ?? null,
            seguidores: p.instagram_business_account.followers_count ?? null,
          }
        : null,
      aviso: p.instagram_business_account
        ? null
        : 'Sin Instagram vinculado: revisá que la cuenta sea Business/Creator y esté conectada a esta Página.',
    }));

    // ── 4.b Prueba directa de una cuenta de IG ────────────────
    // Si le mandás { ig_user_id: "1784..." }, le pega directo a esa
    // cuenta y le pide el alcance de los últimos 7 días. Es el
    // go/no-go: si esto devuelve números, `pull-instagram` va a andar.
    //
    // Nota: la cuenta puede estar asignada al usuario del sistema
    // aunque `/me/accounts` no la muestre colgando de una Página.
    // Por eso la prueba es por ID y no por Página.
    let prueba: Record<string, unknown> | null = null;
    let body: any = {};
    try { body = await req.json(); } catch { /* sin body: no pasa nada */ }

    if (body?.ig_user_id) {
      const igId = String(body.ig_user_id);
      prueba = { ig_user_id: igId };
      try {
        const perfil = await graph(
          `/${igId}?fields=username,name,followers_count,media_count`,
          token,
        );
        (prueba as any).perfil = perfil;

        const hasta = new Date();
        const desde = new Date(hasta.getTime() - 7 * 24 * 60 * 60 * 1000);
        const ins = await graph(
          `/${igId}/insights?metric=reach&period=day` +
            `&since=${Math.floor(desde.getTime() / 1000)}` +
            `&until=${Math.floor(hasta.getTime() / 1000)}`,
          token,
        );
        const valores = ins?.data?.[0]?.values ?? [];
        (prueba as any).alcance_7_dias = valores.reduce(
          (a: number, v: any) => a + (v.value ?? 0), 0,
        );
        (prueba as any).dias_devueltos = valores.length;
        (prueba as any).veredicto = valores.length
          ? 'ANDA — se puede escribir pull-instagram'
          : 'Responde pero sin datos: revisá que la cuenta tenga actividad reciente';
      } catch (e) {
        (prueba as any).veredicto = 'FALLA';
        (prueba as any).error = String(e instanceof Error ? e.message : e);
      }
    }

    // ── 5. Cuentas publicitarias ──────────────────────────────
    // Para la inversión y las conversiones del reporte. Si falla,
    // no rompemos todo: el pull de IG orgánico no depende de esto.
    let adAccounts: unknown[] = [];
    let adError: string | null = null;
    try {
      const ads = await graph(
        '/me/adaccounts?limit=100&fields=id,account_id,name,currency,account_status',
        token,
      );
      adAccounts = (ads?.data ?? []).map((a: any) => ({
        // ⬇️ `cuenta_id` para tipo 'meta_ads' (va con el prefijo act_)
        cuenta_id: a.id,
        nombre: a.name,
        moneda: a.currency,
        activa: a.account_status === 1,
      }));
    } catch (e) {
      adError = String(e instanceof Error ? e.message : e);
    }

    // ── 6. Qué está asignado hoy, para comparar de un vistazo ──
    const { data: yaAsignadas } = await admin
      .from('cliente_integracion')
      .select('tipo, cuenta_id, cuenta_nombre, activo, clientes(nombre)');

    return json({
      ok: true,
      version_api: V,
      token: salud,
      prueba,
      paginas,
      ad_accounts: adAccounts,
      ad_accounts_error: adError,
      ya_asignadas: yaAsignadas ?? [],
      resumen: {
        paginas: paginas.length,
        con_instagram: paginas.filter((p: any) => p.instagram).length,
        ad_accounts: adAccounts.length,
      },
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});