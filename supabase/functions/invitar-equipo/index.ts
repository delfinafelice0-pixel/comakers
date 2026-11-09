// Edge Function `invitar-equipo`
// A) sin password → invita por mail (como siempre).
// B) con password → la socia pone la clave: si la persona existe, se la
//    resetea; si no, la da de alta. Sin mail.
// Gateada a socia activa. La service_role nunca sale del servidor.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MIN_PASS = 8;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function responder(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const URL_SB = Deno.env.get('SUPABASE_URL')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const DESTINO = Deno.env.get('URL_PANEL') ?? 'https://comakers.com.ar/login-comakers.html';

    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return responder({ error: 'Falta la sesión' }, 401);

    const comoLlamante = createClient(URL_SB, ANON, { global: { headers: { Authorization: auth } } });
    const { data: sesion, error: eSesion } = await comoLlamante.auth.getUser();
    if (eSesion || !sesion?.user) return responder({ error: 'Sesión inválida' }, 401);

    const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });
    const { data: quien, error: eQuien } = await admin
      .from('profiles').select('id, rol, activo, tipo, agencia')
      .eq('id', sesion.user.id).single();

    if (eQuien || !quien) return responder({ error: 'No encontramos tu ficha' }, 403);
    if (quien.rol !== 'socia' || quien.activo === false) {
      return responder({ error: 'Solo una socia activa puede invitar gente' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const nombre = String(body.nombre ?? '').trim();
    const rol = body.rol === 'socia' ? 'socia' : 'equipo';
    const passRaw = body.password == null ? '' : String(body.password);
    const conPass = passRaw.trim().length > 0;

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return responder({ error: 'Ese mail no parece válido' }, 400);
    }
    if (conPass && passRaw.length < MIN_PASS) {
      return responder({ error: `La contraseña tiene que tener al menos ${MIN_PASS} caracteres` }, 400);
    }

    const { data: yaEsta } = await admin
      .from('profiles').select('id, activo').eq('email', email).maybeSingle();

    // ── CAMINO B: con contraseña ──────────────────────────────
    if (conPass) {
      if (yaEsta && yaEsta.activo === false) {
        return responder({ error: 'Esa persona está dada de baja. Reactivala antes de ponerle una contraseña.' }, 409);
      }
      if (yaEsta) {
        const { error: eReset } = await admin.auth.admin.updateUserById(yaEsta.id, { password: passRaw });
        if (eReset) return responder({ error: 'No se pudo cambiar la contraseña: ' + eReset.message }, 400);
        return responder({ ok: true, modo: 'reset', id: yaEsta.id, email });
      }
      const { data: creado, error: eCrear } = await admin.auth.admin.createUser({
        email, password: passRaw, email_confirm: true, user_metadata: { nombre },
      });
      if (eCrear || !creado?.user) {
        const m = eCrear?.message ?? '';
        if (/already|registered|exists/i.test(m)) {
          return responder({ error: 'Ese mail ya tiene cuenta pero sin ficha en el panel. Avisá a Delfi.' }, 409);
        }
        return responder({ error: 'No se pudo crear la cuenta: ' + (m || 'error desconocido') }, 400);
      }
      const { error: eFicha } = await admin.from('profiles').upsert({
        id: creado.user.id, email, nombre: nombre || email, tipo: 'agencia',
        agencia: quien.agencia ?? 'CoMakers', rol, activo: true, super_admin: false, invitado_por: quien.id,
      });
      if (eFicha) return responder({ error: 'Se creó la cuenta pero no su ficha: ' + eFicha.message }, 500);
      return responder({ ok: true, modo: 'alta', id: creado.user.id, email, nombre, rol });
    }

    // ── CAMINO A: invitación por mail ─────────────────────────
    if (yaEsta) {
      return responder({
        error: yaEsta.activo === false
          ? 'Esa persona ya está en el equipo, pero dada de baja. Reactivala desde el panel.'
          : 'Esa persona ya está en el equipo.',
      }, 409);
    }
    const { data: creado, error: eInvitar } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: DESTINO, data: { nombre },
    });
    if (eInvitar || !creado?.user) {
      return responder({ error: eInvitar?.message ?? 'No se pudo enviar la invitación' }, 400);
    }
    const { error: eFicha } = await admin.from('profiles').upsert({
      id: creado.user.id, email, nombre: nombre || email, tipo: 'agencia',
      agencia: quien.agencia ?? 'CoMakers', rol, activo: true, super_admin: false, invitado_por: quien.id,
    });
    if (eFicha) return responder({ error: 'Se creó la cuenta pero no su ficha: ' + eFicha.message }, 500);
    return responder({ ok: true, modo: 'invitado', id: creado.user.id, email, nombre, rol });
  } catch (e) {
    return responder({ error: String((e as Error).message ?? e) }, 500);
  }
});
