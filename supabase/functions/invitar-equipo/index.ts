// ═══════════════════════════════════════════════════════════════
//  Edge Function `invitar-equipo`
//
//  Alta y manejo de cuentas desde administración. Cuatro cosas:
//
//    A) Equipo por mail      → invita por mail para que ponga su clave
//                              (tipo='agencia', rol socia/equipo).
//    B) Equipo con clave      → la socia le pone la contraseña directo.
//                              Si ya existe, se la resetea.
//    C) Cliente con clave      → crea un usuario tipo='cliente' con
//                              contraseña y le asigna qué cliente(s)
//                              puede ver (filas en `acceso_cliente`).
//    D) Cambiar mail          → { accion:'cambiar-mail', id, email_nuevo }:
//                              cambia el mail de login de un usuario
//                              cliente (auth + profiles.email).
//
//  Un cliente NO entra a administración ni interno: esos paneles
//  rebotan a cualquier perfil que no sea tipo='agencia'/super. Acá solo
//  nos aseguramos de crearlo bien y de no asignarle clientes ajenos.
//
//  Gateada a socia activa. La service_role nunca sale del servidor.
// ═══════════════════════════════════════════════════════════════

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
      .from('profiles').select('id, rol, activo, tipo, agencia, super_admin')
      .eq('id', sesion.user.id).single();

    if (eQuien || !quien) return responder({ error: 'No encontramos tu ficha' }, 403);
    if (quien.rol !== 'socia' || quien.activo === false) {
      return responder({ error: 'Solo una socia activa puede invitar gente' }, 403);
    }

    const body = await req.json().catch(() => ({}));

    // ─────────────────────────────────────────────────────────────
    //  CAMINO D · Cambiar el mail de login de un usuario cliente
    //  Es un vector de toma de cuenta: mismas guardas que el reseteo de
    //  clave. El objetivo se identifica por id, nunca por el mail viejo.
    // ─────────────────────────────────────────────────────────────
    if (body.accion === 'cambiar-mail') {
      const id = String(body.id ?? '').trim();
      const nuevo = String(body.email_nuevo ?? '').trim().toLowerCase();
      if (!id) return responder({ error: 'Falta a quién cambiarle el mail' }, 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nuevo)) {
        return responder({ error: 'Ese mail no parece válido' }, 400);
      }
      const { data: obj } = await admin
        .from('profiles').select('id, email, activo, tipo, super_admin, agencia')
        .eq('id', id).maybeSingle();
      if (!obj) return responder({ error: 'No encontramos esa cuenta' }, 404);
      if (obj.super_admin === true)
        return responder({ error: 'No podés cambiarle el mail a un super-admin desde acá.' }, 403);
      if (obj.tipo !== 'cliente')
        return responder({ error: 'Esto es solo para usuarios cliente.' }, 403);
      if ((obj.agencia ?? null) !== (quien.agencia ?? null))
        return responder({ error: 'Solo podés tocar cuentas de tu propia agencia.' }, 403);
      if (obj.activo === false)
        return responder({ error: 'Esa cuenta está dada de baja. Reactivala antes de cambiarle el mail.' }, 409);
      if ((obj.email ?? '').toLowerCase() === nuevo)
        return responder({ error: 'Ese ya es su mail.' }, 400);

      const enUso = 'Ese mail ya lo usa otra cuenta. Elegí otro.';
      const { data: otro } = await admin.from('profiles').select('id').eq('email', nuevo).neq('id', id).maybeSingle();
      if (otro) return responder({ error: enUso }, 409);

      const { error: eMail } = await admin.auth.admin.updateUserById(id, { email: nuevo, email_confirm: true });
      if (eMail) {
        if (/already|registered|exists|taken|in use/i.test(eMail.message ?? '')) return responder({ error: enUso }, 409);
        return responder({ error: 'No se pudo cambiar el mail: ' + eMail.message }, 400);
      }
      const { error: eFicha } = await admin.from('profiles').update({ email: nuevo }).eq('id', id);
      if (eFicha) {
        // Que auth y ficha no queden distintos: se vuelve al mail viejo.
        await admin.auth.admin.updateUserById(id, { email: obj.email, email_confirm: true });
        return responder({ error: 'No se pudo actualizar la ficha (' + eFicha.message + '). El mail no cambió.' }, 500);
      }
      return responder({ ok: true, modo: 'cambio-mail', id, email: nuevo });
    }

    const email = String(body.email ?? '').trim().toLowerCase();
    const nombre = String(body.nombre ?? '').trim();
    const tipo = body.tipo === 'cliente' ? 'cliente' : 'agencia';
    const rol = body.rol === 'socia' ? 'socia' : 'equipo';
    const clientesPedidos = Array.isArray(body.clientes) ? body.clientes.filter(Boolean) : [];
    const passRaw = body.password == null ? '' : String(body.password);
    const conPass = passRaw.trim().length > 0;

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return responder({ error: 'Ese mail no parece válido' }, 400);
    }
    if (conPass && passRaw.length < MIN_PASS) {
      return responder({ error: `La contraseña tiene que tener al menos ${MIN_PASS} caracteres` }, 400);
    }

    // ── Validar los clientes asignados (solo los de tu agencia) ──
    // Esto evita que, aun siendo socia, se le asigne a alguien un
    // cliente de otra agencia. El super puede asignar cualquiera.
    let clientesOk: string[] = [];
    if (tipo === 'cliente') {
      if (!conPass) {
        return responder({ error: 'Un cliente se crea con contraseña.' }, 400);
      }
      if (!clientesPedidos.length) {
        return responder({ error: 'Elegí al menos un cliente que esta persona pueda ver.' }, 400);
      }
      let q = admin.from('clientes').select('id').in('id', clientesPedidos);
      if (!quien.super_admin) q = q.eq('agencia', quien.agencia);
      const { data: validos } = await q;
      clientesOk = (validos ?? []).map((c: { id: string }) => c.id);
      if (!clientesOk.length) {
        return responder({ error: 'Esos clientes no son de tu agencia.' }, 403);
      }
    }

    const { data: yaEsta } = await admin
      .from('profiles').select('id, activo, tipo, super_admin, agencia')
      .eq('email', email).maybeSingle();

    // Escribe las filas de acceso_cliente para un user_id dado (additivo).
    async function asignarClientes(userId: string) {
      if (!clientesOk.length) return null;
      const filas = clientesOk.map((cid) => ({ cliente_id: cid, user_id: userId }));
      const { error } = await admin.from('acceso_cliente')
        .upsert(filas, { onConflict: 'cliente_id,user_id' });
      return error;
    }

    // ─────────────────────────────────────────────────────────────
    //  CAMINO C · Cliente con contraseña
    // ─────────────────────────────────────────────────────────────
    if (tipo === 'cliente') {
      // Si el mail ya es una cuenta del EQUIPO, no lo convertimos en cliente
      // ni le pisamos la contraseña por error: avisamos y paramos.
      if (yaEsta && yaEsta.tipo === 'agencia') {
        return responder({ error: 'Ese mail ya es de una cuenta del equipo. No lo paso a cliente desde acá para no pisarle la contraseña.' }, 409);
      }
      if (yaEsta && yaEsta.activo === false) {
        return responder({ error: 'Esa persona está dada de baja. Reactivala antes de darle acceso.' }, 409);
      }
      // Ya existe → le reseteamos la clave y sumamos sus clientes.
      if (yaEsta) {
        // Como en el camino B: solo cuentas de tu misma agencia.
        if ((yaEsta.agencia ?? null) !== (quien.agencia ?? null))
          return responder({ error: 'Solo podés tocar cuentas de tu propia agencia.' }, 403);
        const { error: eReset } = await admin.auth.admin.updateUserById(yaEsta.id, { password: passRaw });
        if (eReset) return responder({ error: 'No se pudo cambiar la contraseña: ' + eReset.message }, 400);
        const eAcc = await asignarClientes(yaEsta.id);
        if (eAcc) return responder({ error: 'Clave cambiada, pero falló asignar clientes: ' + eAcc.message }, 500);
        return responder({ ok: true, modo: 'reset-cliente', id: yaEsta.id, email, clientes: clientesOk });
      }
      // No existe → alta como cliente.
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
        id: creado.user.id, email, nombre: nombre || email, tipo: 'cliente',
        agencia: quien.agencia ?? 'CoMakers', rol: 'equipo', activo: true, super_admin: false, invitado_por: quien.id,
      });
      if (eFicha) return responder({ error: 'Se creó la cuenta pero no su ficha: ' + eFicha.message }, 500);
      const eAcc = await asignarClientes(creado.user.id);
      if (eAcc) return responder({ error: 'Cuenta creada, pero falló asignar clientes: ' + eAcc.message }, 500);
      return responder({ ok: true, modo: 'alta-cliente', id: creado.user.id, email, nombre, clientes: clientesOk });
    }

    // ─────────────────────────────────────────────────────────────
    //  CAMINO B · Equipo con contraseña (la socia pone la clave)
    // ─────────────────────────────────────────────────────────────
    if (conPass) {
      if (yaEsta && yaEsta.activo === false) {
        return responder({ error: 'Esa persona está dada de baja. Reactivala antes de ponerle una contraseña.' }, 409);
      }
      if (yaEsta) {
        // Solo se resetea a alguien del equipo de tu misma agencia, y nunca a un super-admin.
        if (yaEsta.super_admin === true)
          return responder({ error: 'No podés cambiarle la contraseña a un super-admin desde acá.' }, 403);
        if (yaEsta.tipo === 'cliente')   // tipo vacío (perfiles viejos del equipo) sí se deja
          return responder({ error: 'Esto es solo para el equipo. Para un cliente usá la opción de cliente.' }, 403);
        if ((yaEsta.agencia ?? null) !== (quien.agencia ?? null))
          return responder({ error: 'Solo podés tocar cuentas de tu propia agencia.' }, 403);
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

    // ─────────────────────────────────────────────────────────────
    //  CAMINO A · Equipo por mail (invitación)
    // ─────────────────────────────────────────────────────────────
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
