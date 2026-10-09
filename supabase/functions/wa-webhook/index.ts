// ═══════════════════════════════════════════════════════════════
//  Edge Function · wa-webhook
//  Recibe los mensajes de WhatsApp Cloud API y los guarda en las
//  tablas del CRM (migración 46: conversacion, mensaje,
//  conversacion_pauta). NO manda nada ni escribe evento_capi (eso lo
//  encola un trigger cuando cambia conversacion.estado).
//
//  Deploy:
//    supabase functions deploy wa-webhook --no-verify-jwt
//    (--no-verify-jwt: es un endpoint PÚBLICO que llama Meta sin
//     Authorization. La autenticación es la firma X-Hub-Signature-256,
//     no el JWT de Supabase.)
//
//  Secrets (Supabase → Edge Functions → Secrets; NUNCA en el repo):
//    WHATSAPP_APP_SECRET     app secret de Meta, para validar la firma
//    WHATSAPP_VERIFY_TOKEN   token del handshake de verificación (GET)
//    SUPABASE_URL            ya existe
//    SUPABASE_SERVICE_ROLE_KEY  ya existe · se usa ESTA, no la anon
//
//  Rutas:
//    GET   → handshake de verificación de Meta (hub.challenge)
//    POST  → entrega de eventos (mensajes entrantes y ecos del negocio)
//
//  Probar sin número conectado: supabase/functions/wa-webhook/probar-webhook.sh
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';
const APP_SECRET   = Deno.env.get('WHATSAPP_APP_SECRET') ?? '';

// service_role: el webhook es ingestión de sistema, sin usuario
// logueado. Saltea RLS a propósito (conversacion_pauta y los mapeos
// no tienen policies para nadie que no sea service_role).
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// ── Firma de Meta ────────────────────────────────────────────────
// HMAC-SHA256 del body CRUDO con el app secret. Hay que hashear los
// bytes exactos que mandó Meta: por eso el handler lee req.text() y
// recién después parsea. Si parseáramos y re-serializáramos, un
// espacio o un orden de claves distinto rompería el hash.
async function hmacHex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Comparación en tiempo constante: no cortar al primer byte distinto,
// para no filtrar cuánto de la firma era correcta.
function igualesEnTiempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function firmaValida(raw: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET || !header || !header.startsWith('sha256=')) return false;
  const esperado = await hmacHex(APP_SECRET, raw);
  return igualesEnTiempoConstante(header.slice('sha256='.length), esperado);
}

// ── Utilidades ───────────────────────────────────────────────────
const soloDigitos = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

// El texto lo escriben desconocidos. Acá se guarda tal cual (sin
// formatear); el escape y el renderTexto van en crm.html, al dibujar.
// Para los tipos que no son texto se guarda un rótulo, no el binario.
function textoDeMensaje(m: any): string {
  switch (m?.type) {
    case 'text':        return m.text?.body ?? '';
    case 'image':       return m.image?.caption ? '[imagen] ' + m.image.caption : '[imagen]';
    case 'video':       return m.video?.caption ? '[video] ' + m.video.caption : '[video]';
    case 'audio':       return '[audio]';
    case 'document':    return m.document?.filename ? '[documento] ' + m.document.filename : '[documento]';
    case 'sticker':     return '[sticker]';
    case 'location':    return '[ubicación]';
    case 'contacts':    return '[contacto]';
    case 'button':      return m.button?.text ?? '[botón]';
    case 'interactive': return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '[interacción]';
    case 'reaction':    return m.reaction?.emoji ? '[reacción] ' + m.reaction.emoji : '[reacción]';
    default:            return '[' + (m?.type ?? 'mensaje') + ']';
  }
}

// ── Guardado ─────────────────────────────────────────────────────
// Crea la conversación en el primer mensaje y NO la pisa después:
// estado, origen, nota del equipo y nombre ya puesto se respetan. El
// insert con do-nothing es lo que garantiza eso ante los reintentos
// de Meta (que mandan el mismo evento más de una vez).
async function asegurarConversacion(
  clienteId: string, telefono: string, nombre: string | null,
): Promise<string | null> {
  await admin.from('conversacion').upsert(
    { cliente_id: clienteId, telefono, nombre },
    { onConflict: 'cliente_id,telefono', ignoreDuplicates: true },
  );

  const { data } = await admin.from('conversacion')
    .select('id, nombre')
    .eq('cliente_id', clienteId).eq('telefono', telefono)
    .maybeSingle();
  if (!data) return null;

  // Si no teníamos nombre y ahora Meta lo manda, lo completamos sin
  // pisar uno que ya estuviera cargado.
  if (nombre && !data.nombre) {
    await admin.from('conversacion').update({ nombre }).eq('id', data.id);
  }
  return data.id;
}

// Referral con ctwa_clid: llega en el mensaje de un clic de anuncio
// Click-to-WhatsApp. Marca la conversación como pauta y guarda el clid
// (sin él, el evento de conversión se procesa pero Meta no lo atribuye
// al anuncio).
//
// recibido_en define la ventana gratis de 72 h (migración 53), y se
// cuenta DESDE EL REFERRAL, no desde el último entrante. Por eso un
// clic nuevo tiene que REABRIR la ventana: do-update de recibido_en y
// clid, no do-nothing. Se usa el timestamp del mensaje (no now()) para
// que reprocesar el mismo webhook sea idempotente y solo un clic real
// nuevo mueva la fecha.
async function marcarPauta(conversacionId: string, referral: any, recibidoEn: string): Promise<void> {
  // ad_id = source_id del referral. `campana`: Meta NO manda el nombre
  // de la campaña en el referral; lo más cercano legible es el headline
  // del anuncio. El nombre real de campaña, si se quiere, se enriquece
  // después contra Graph — fuera de este webhook.
  await admin.from('conversacion').update({
    origen: 'pauta',
    ad_id: referral.source_id ?? null,
    campana: referral.headline ?? referral.body ?? null,
  }).eq('id', conversacionId);

  // Último clic gana: un referral nuevo reabre la ventana (do-update
  // de clid + recibido_en). Sin ignoreDuplicates, el upsert hace
  // ON CONFLICT DO UPDATE sobre las columnas que le paso.
  await admin.from('conversacion_pauta').upsert(
    { conversacion_id: conversacionId, ctwa_clid: referral.ctwa_clid, recibido_en: recibidoEn },
    { onConflict: 'conversacion_id' },
  );
}

async function guardarMensaje(
  clienteId: string, m: any, entrante: boolean, contactos: any[],
): Promise<void> {
  if (!m?.id) return;

  // El teléfono del CONTACTO, no el del negocio:
  //   entrante → m.from (quien escribió)
  //   eco      → m.to   (a quién le contestó el negocio)
  const telefono = soloDigitos(entrante ? m.from : m.to);
  if (!telefono) return;

  // Nombre: solo viene en los entrantes, en value.contacts.
  let nombre: string | null = null;
  if (entrante) {
    const c = contactos.find((x) => soloDigitos(x?.wa_id) === telefono) ?? contactos[0];
    nombre = c?.profile?.name ?? null;
  }

  const conversacionId = await asegurarConversacion(clienteId, telefono, nombre);
  if (!conversacionId) return;

  const enviadoEn = m.timestamp
    ? new Date(Number(m.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  // Idempotencia: mensaje.wa_id es UNIQUE. do-nothing porque Meta
  // reintenta los webhooks y no queremos duplicar el mismo mensaje.
  await admin.from('mensaje').upsert(
    { conversacion_id: conversacionId, wa_id: m.id, entrante, texto: textoDeMensaje(m), enviado_en: enviadoEn },
    { onConflict: 'wa_id', ignoreDuplicates: true },
  );

  if (entrante && m.referral?.ctwa_clid) {
    await marcarPauta(conversacionId, m.referral, enviadoEn);
  }

  // La conversación sube al tope de la bandeja. El filtro evita que un
  // evento reordenado o reintentado la mande para atrás en el tiempo.
  await admin.from('conversacion')
    .update({ ultimo_en: enviadoEn, actualizado_en: new Date().toISOString() })
    .eq('id', conversacionId)
    .or(`ultimo_en.is.null,ultimo_en.lt.${enviadoEn}`);
}

async function procesar(cuerpo: any): Promise<void> {
  if (cuerpo?.object !== 'whatsapp_business_account') return;

  for (const entry of cuerpo.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change?.value ?? {};
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // Mapeo phone_number_id → cliente (solo activo). Sin mapeo, se
      // loguea y se sigue: Meta manda webhooks de cosas que no pedimos
      // y no queremos insertar basura ni que reintente para siempre.
      const { data: mapeo } = await admin.from('cliente_whatsapp')
        .select('cliente_id').eq('phone_number_id', phoneNumberId).eq('activo', true)
        .maybeSingle();
      if (!mapeo) {
        console.log('wa-webhook: phone_number_id sin cliente activo, ignorado:', phoneNumberId);
        continue;
      }
      const clienteId = mapeo.cliente_id;
      const contactos = value.contacts ?? [];

      // Entrantes y ecos llegan en campos distintos del mismo value.
      // Los ecos (smb_message_echoes) son lo que el negocio mandó desde
      // su celular: entrante = false.
      for (const m of value.messages ?? [])        await guardarMensaje(clienteId, m, true, contactos);
      for (const m of value.message_echoes ?? [])  await guardarMensaje(clienteId, m, false, contactos);
    }
  }
}

// ── Handler ──────────────────────────────────────────────────────
const ok = () => new Response('EVENT_RECEIVED', { status: 200 });

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // GET: handshake de verificación de Meta.
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    if (mode === 'subscribe' && VERIFY_TOKEN && token && igualesEnTiempoConstante(token, VERIFY_TOKEN)) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  // Body CRUDO primero, para el HMAC.
  const raw = await req.text();
  if (!(await firmaValida(raw, req.headers.get('x-hub-signature-256')))) {
    // Sin firma válida no es Meta (o está mal configurado). No se
    // inserta nada: es justo lo que esta validación evita.
    return new Response('Firma inválida', { status: 401 });
  }

  let cuerpo: unknown;
  try { cuerpo = JSON.parse(raw); } catch { return ok(); }

  try {
    await procesar(cuerpo);
  } catch (e) {
    // Firma ya validada: si fallamos nosotros, 200 igual + log, para no
    // disparar reintentos infinitos por un mensaje envenenado. El error
    // queda registrado.
    console.error('wa-webhook: error procesando el evento:', e);
  }
  return ok();
});
