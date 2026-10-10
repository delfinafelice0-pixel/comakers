// ═══════════════════════════════════════════════════════════════
//  Edge Function · wa-enviar
//  Responde una conversación de WhatsApp desde el panel, SOLO dentro
//  de la ventana gratis de 72 h que abre un clic a un anuncio
//  Click-to-WhatsApp. El módulo se vende como costo cero: mandar fuera
//  de esa ventana se cobra a tarifa utility, así que acá no se hace.
//
//  La validación de la ventana vive ACÁ, nunca en el navegador: el
//  panel muestra la caja como pista, pero esta función revalida en
//  cada envío y rechaza si no corresponde.
//
//  Deploy (con verificación de JWT: lo llama el panel con su sesión,
//  no Meta):
//    supabase functions deploy wa-enviar
//
//  Secrets:
//    WHATSAPP_TEST_TOKEN      token del número de PRUEBA de Meta
//    WHATSAPP_TEST_PHONE_ID   phone_number_id del número de prueba
//    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (ya están)
//  (Los tokens por cliente vienen post App Review, con su migración.)
//
//  Body: { conversacion_id: uuid, texto: string, idem_key: uuid }
//    idem_key la genera el panel por intento: dos clicks con la misma
//    = un solo envío (dedupe en outbox_envio, migración 53).
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS, json, GRAPH } from '../_shared/meta.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VENTANA_MS = 72 * 60 * 60 * 1000;
const MAX_TEXTO = 4096;   // tope del body de texto de WhatsApp

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: { message: 'Method Not Allowed' } }, 405);

  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: { message: 'Sin sesión' } }, 401);

    let body: any = {};
    try { body = await req.json(); } catch { /* vacío */ }

    const conversacionId = body?.conversacion_id ? String(body.conversacion_id) : '';
    const idemKey = body?.idem_key ? String(body.idem_key) : '';
    const texto = typeof body?.texto === 'string' ? body.texto.trim() : '';

    if (!UUID_RE.test(conversacionId)) return json({ error: { message: 'Falta la conversación' } }, 400);
    if (!UUID_RE.test(idemKey)) return json({ error: { message: 'Falta la idem_key' } }, 400);
    if (!texto) return json({ error: { message: 'El mensaje está vacío' } }, 400);
    if (texto.length > MAX_TEXTO) return json({ error: { message: 'El mensaje es demasiado largo' } }, 400);

    // ── 1. Quién llama: la RLS decide si puede ver la conversación ──
    // Con la anon key + el Authorization del usuario, el select pasa por
    // las policies de la 46. Si no la puede ver, no la puede responder.
    const llamador = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: conv, error: errConv } = await llamador
      .from('conversacion').select('id, telefono').eq('id', conversacionId).maybeSingle();
    if (errConv) return json({ error: { message: 'No se pudo verificar la conversación' } }, 500);
    if (!conv) return json({ error: { message: 'No tenés acceso a esta conversación' } }, 403);

    const destino = String(conv.telefono || '').replace(/\D/g, '');
    if (!destino) return json({ error: { message: 'La conversación no tiene teléfono' } }, 400);

    // ── 2. service_role para todo lo que la RLS esconde ────────────
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // ── 3. La ventana, revalidada en el servidor ───────────────────
    // 72 h desde conversacion_pauta.recibido_en (el referral), NO desde
    // el último entrante. Sin fila, no vino por un anuncio.
    const { data: pauta } = await admin
      .from('conversacion_pauta').select('recibido_en').eq('conversacion_id', conversacionId).maybeSingle();

    if (!pauta) {
      return json({ error: { code: 'sin_ventana', message: 'Esta conversación no entró por un anuncio: no hay ventana gratis.' } }, 409);
    }
    const abiertaDesde = new Date(pauta.recibido_en).getTime();
    if (!(Date.now() - abiertaDesde < VENTANA_MS)) {
      return json({ error: { code: 'ventana_vencida', message: 'La ventana gratis de 72 h se cerró. Responder ahora tendría costo.' } }, 409);
    }

    // ── 4. Idempotencia: reclamar la idem_key ANTES de llamar a Meta ──
    // Meta no deduplica; el wa_id recién existe cuando responde. El
    // outbox es la clave de dedupe: si ya existe esta idem_key, es un
    // reintento y devolvemos el resultado anterior sin reenviar.
    const { data: reclamo } = await admin
      .from('outbox_envio')
      .upsert({ idem_key: idemKey, conversacion_id: conversacionId, texto }, { onConflict: 'idem_key', ignoreDuplicates: true })
      .select('idem_key');

    const reclamada = reclamo && reclamo.length > 0;
    if (!reclamada) {
      // Ya existía: devolvemos lo que haya pasado con ese envío.
      const { data: prev } = await admin
        .from('outbox_envio').select('estado, wa_id, detalle').eq('idem_key', idemKey).maybeSingle();
      if (prev?.estado === 'ok') return json({ ok: true, wa_id: prev.wa_id, repetido: true });
      if (prev?.estado === 'error') return json({ error: { message: prev.detalle || 'El envío anterior falló.' } }, 502);
      return json({ error: { code: 'en_curso', message: 'Ese envío ya está en curso.' } }, 409);
    }

    // ── 5. Enviar a Meta ───────────────────────────────────────────
    const token = Deno.env.get('WHATSAPP_TEST_TOKEN');
    const phoneId = Deno.env.get('WHATSAPP_TEST_PHONE_ID');
    if (!token || !phoneId) {
      await admin.from('outbox_envio').update({ estado: 'error', detalle: 'Faltan los secrets del número de prueba.', actualizado_en: new Date().toISOString() }).eq('idem_key', idemKey);
      return json({ error: { message: 'Falta configurar el número de envío en el servidor.' } }, 500);
    }

    let resp: Response, data: any;
    try {
      resp = await fetch(`${GRAPH}/${phoneId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: destino, type: 'text', text: { body: texto } }),
      });
      data = await resp.json().catch(() => ({}));
    } catch (e) {
      await admin.from('outbox_envio').update({ estado: 'error', detalle: 'No se pudo contactar a Meta.', intentos: 1, actualizado_en: new Date().toISOString() }).eq('idem_key', idemKey);
      return json({ error: { message: 'No se pudo contactar a Meta.' } }, 502);
    }

    const wamid = data?.messages?.[0]?.id;
    if (!resp.ok || !wamid) {
      const detalle = data?.error?.message || `Meta rechazó el envío (${resp.status}).`;
      await admin.from('outbox_envio').update({ estado: 'error', detalle, intentos: 1, actualizado_en: new Date().toISOString() }).eq('idem_key', idemKey);
      return json({ error: { message: detalle } }, 502);
    }

    // ── 6. Recién ahora se guarda en mensaje, con el wamid real ────
    // El mismo mensaje vuelve como eco (smb_message_echoes) con este
    // wamid; el on conflict (wa_id) do nothing deduplica → una fila.
    const ahora = new Date().toISOString();
    await admin.from('outbox_envio').update({ estado: 'ok', wa_id: wamid, actualizado_en: ahora }).eq('idem_key', idemKey);
    await admin.from('mensaje').upsert(
      { conversacion_id: conversacionId, wa_id: wamid, entrante: false, texto, enviado_en: ahora },
      { onConflict: 'wa_id', ignoreDuplicates: true },
    );
    await admin.from('conversacion').update({ ultimo_en: ahora, actualizado_en: ahora }).eq('id', conversacionId);

    return json({ ok: true, wa_id: wamid });
  } catch (e) {
    console.error('wa-enviar error:', e);
    return json({ error: { message: 'Error inesperado al enviar.' } }, 500);
  }
});
