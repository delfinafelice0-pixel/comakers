// ═══════════════════════════════════════════════════════════════
//  Edge Function · analizar-reporte
//  Escribe un borrador de `analisis` a partir de los números del mes
//  y del mes anterior. Nunca pisa lo que escribimos a mano.
//
//  Deploy:
//    supabase functions deploy analizar-reporte
//  Secret:
//    supabase secrets set ANTHROPIC_API_KEY="sk-ant-..."
//
//  Body: { cliente_id: "uuid", mes: "2026-08" }
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.125.0';

const MODELO = 'claude-opus-5';
const TZ = 'America/Argentina/Buenos_Aires';

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

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

const etiquetaMes = (mes: string) => {
  const [y, m] = mes.split('-');
  return `${MESES_ES[parseInt(m, 10) - 1]} ${y}`;
};

function mesAnterior(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function mesActualEnBA(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' })
    .format(new Date()).slice(0, 7);
}

// ─────────────────────────────────────────────────────────────
//  Las métricas que ve el modelo. Solo orgánico: la pauta se carga
//  a mano y mezclarla invita a que relacione cosas que no sabe.
//  El rótulo es el que usaría una persona, nunca el nombre de la
//  columna — el prompt prohíbe la jerga y no queremos filtrarla
//  por la puerta de atrás.
// ─────────────────────────────────────────────────────────────
const METRICAS: Array<{ col: string; rotulo: string; sangria?: boolean }> = [
  { col: 'views_org',           rotulo: 'Visualizaciones' },
  { col: 'views_org_historias', rotulo: 'en historias', sangria: true },
  { col: 'views_org_posts',     rotulo: 'en posteos', sangria: true },
  { col: 'views_org_reels',     rotulo: 'en reels', sangria: true },
  { col: 'reach_org',           rotulo: 'Alcance' },
  { col: 'likes_org',           rotulo: 'Me gusta' },
  { col: 'comments_org',        rotulo: 'Comentarios' },
  { col: 'shares_org',          rotulo: 'Compartidos' },
  { col: 'saves_org',           rotulo: 'Guardados' },
  { col: 'replies_org',         rotulo: 'Respuestas' },
  { col: 'reposts_org',         rotulo: 'Republicaciones' },
  { col: 'inter_posts_org',     rotulo: 'Interacciones en posteos' },
  { col: 'inter_reels_org',     rotulo: 'Interacciones en reels' },
  { col: 'follows_mes',         rotulo: 'Seguidores nuevos' },
  { col: 'unfollows_mes',       rotulo: 'Dejaron de seguir' },
];

const COLUMNAS = METRICAS.map((m) => m.col).join(', ');

// "sin dato" y 0 son cosas distintas y el prompt insiste en eso.
// Acá se decide cuál es cuál, una sola vez.
const mostrar = (v: unknown): string =>
  v === null || v === undefined ? 'sin dato' : String(v);

function tablaDeNumeros(actual: any, previo: any | null, mes: string, mesPrev: string): string {
  const anchoRot = 28;
  const anchoCol = 12;
  const cab = 'Métrica'.padEnd(anchoRot) +
    etiquetaMes(mes).padStart(anchoCol) +
    (previo ? etiquetaMes(mesPrev).padStart(anchoCol) : '');

  const filas = METRICAS.map((m) => {
    const rot = (m.sangria ? '  ' : '') + m.rotulo;
    return rot.padEnd(anchoRot) +
      mostrar(actual[m.col]).padStart(anchoCol) +
      (previo ? mostrar(previo[m.col]).padStart(anchoCol) : '');
  });

  return [cab, '─'.repeat(cab.length), ...filas].join('\n');
}

const SISTEMA = `Sos analista en una agencia de marketing digital argentina. Escribís el comentario mensual que la agencia le manda a su cliente sobre su cuenta de Instagram.

Reglas:
- Escribí 2 o 3 párrafos corridos. Sin títulos, sin viñetas, sin listas, sin despedida ni firma.
- Español rioplatense, voseo. Tono profesional y cálido, de agencia hablándole a su cliente. Nada de jerga técnica.
- Nunca nombres métricas por su nombre técnico ni menciones tablas, columnas, APIs ni Instagram Insights. Decí "las visualizaciones", "los guardados", "los seguidores nuevos".
- Solo podés usar los números que te paso. No inventes ni estimes ninguno. No calcules nada que no esté en los datos, salvo las variaciones entre los dos meses.
- No expliques por qué pasaron las cosas. Podés decir qué cambió y cuánto. No atribuyas causas: no sabés qué se publicó, ni qué pasó en el negocio, ni qué hizo la competencia. Frases como "esto se debe a", "gracias al buen contenido" o "el algoritmo" están prohibidas.
- Si una métrica dice "sin dato", decí que ese dato no está disponible este mes. Nunca la trates como cero ni la ignores como si fuera cero. Un cero explícito sí es un cero real y se puede nombrar como tal.
- Si un número subió o bajó mucho, decilo con precisión y sin dramatizar. No lo llames "explosivo", "histórico" ni "preocupante": dado que no podés explicar la causa, tampoco podés saber si es bueno o malo. Describilo y seguí.
- No comprometas acciones de la agencia. No prometas entregables, reuniones, propuestas, informes ni plazos, y no digas qué va a hacer el equipo el mes que viene: eso lo decide la agencia con su cliente, no vos. Podés señalar qué conviene mirar u observar en los próximos meses, en términos de qué números seguir. Frases como "te acercamos la propuesta", "lo vemos juntos en la reunión" o "vamos a trabajar en" están prohibidas.
- Si no hay mes anterior, describí el mes solo, sin comparar y sin mencionar que falta la comparación.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: { message: 'Sin sesión' } }, 401);

    let body: any = {};
    try { body = await req.json(); } catch { /* vacío */ }

    const clienteId = body?.cliente_id ? String(body.cliente_id) : null;
    if (!clienteId) return json({ error: { message: 'Falta el cliente' } }, 400);

    const mes = body?.mes ? String(body.mes).slice(0, 7) : mesActualEnBA();
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return json({ error: { message: 'El mes tiene que venir como AAAA-MM' } }, 400);
    }

    // ── 1. El acceso lo decide RLS, no un if nuestro ──────────
    const llamador = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: cliente, error: errCli } = await llamador
      .from('clientes').select('id, nombre').eq('id', clienteId).maybeSingle();

    if (errCli) return json({ error: { message: 'No se pudo verificar el acceso al cliente' } }, 500);
    if (!cliente) return json({ error: { message: 'No tenés acceso a este cliente' } }, 403);

    // ── 2. Service role: leer la fila y, al final, escribir ────
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const mesPrev = mesAnterior(mes);
    const { data: filas } = await admin
      .from('reporte')
      .select(`id, mes, analisis, analisis_generado_en, ${COLUMNAS}`)
      .eq('cliente_id', clienteId)
      .in('mes', [`${mes}-01`, `${mesPrev}-01`]);

    const actual = (filas ?? []).find((f: any) => String(f.mes).slice(0, 7) === mes) ?? null;
    const previo = (filas ?? []).find((f: any) => String(f.mes).slice(0, 7) === mesPrev) ?? null;

    if (!actual) {
      return json({
        error: { message: `Todavía no hay reporte de ${etiquetaMes(mes)} para ${cliente.nombre}.` },
      }, 404);
    }

    // ── 3. Lo escrito a mano es intocable ─────────────────────
    // Lo escrito a mano no se pisa nunca. Un borrador generado y sin
    // revisar sí se puede regenerar: no hay trabajo humano que perder.
    const hayTexto = actual.analisis && String(actual.analisis).trim() !== '';
    const esBorradorSinRevisar = !!actual.analisis_generado_en;

    if (hayTexto && !esBorradorSinRevisar) {
      return json({
        error: {
          message: `El análisis de ${etiquetaMes(mes)} lo escribió una persona. No se pisa: borralo desde el panel si querés generar uno nuevo.`,
          motivo: 'analisis_escrito_a_mano',
        },
      }, 409);
    }

    // Si no hay un solo número, no hay nada que contar.
    const hayAlgo = METRICAS.some((m) => (actual as any)[m.col] !== null && (actual as any)[m.col] !== undefined);
    if (!hayAlgo) {
      return json({
        error: { message: `El reporte de ${etiquetaMes(mes)} no tiene ningún número cargado todavía.` },
      }, 409);
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: { message: 'Falta configurar el acceso a Claude en el servidor.' } }, 500);

    // ── 4. El pedido ──────────────────────────────────────────
    const tabla = tablaDeNumeros(actual, previo, mes, mesPrev);
    const prompt = [
      `Cliente: ${cliente.nombre}`,
      `Mes del reporte: ${etiquetaMes(mes)}`,
      previo ? `Mes anterior: ${etiquetaMes(mesPrev)}` : 'No hay datos del mes anterior.',
      '',
      tabla,
      '',
      'Escribí el comentario del mes.',
    ].join('\n');

    const anthropic = new Anthropic({ apiKey });

    const respuesta = await anthropic.beta.messages.create({
      model: MODELO,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SISTEMA,
      messages: [{ role: 'user', content: prompt }],
    });

    // Siempre mirar stop_reason antes de leer content.
    if (respuesta.stop_reason === 'refusal') {
      return json({
        error: { message: 'Claude no pudo generar el texto para este reporte. Escribilo a mano.' },
      }, 502);
    }

    const texto = respuesta.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
      .trim();

    if (!texto) {
      return json({ error: { message: 'Claude devolvió una respuesta vacía.' } }, 502);
    }

    // ── 5. Escribir. Solo `analisis` y su marca de borrador. ──
    // `analisis_generado_en` con fecha significa "esto lo escribió
    // Claude y nadie lo revisó todavía". El panel lo usa para avisarlo,
    // y el editor la pone en null en cuanto una persona guarda.
    const { error: errUp } = await admin
      .from('reporte')
      .update({ analisis: texto, analisis_generado_en: new Date().toISOString() })
      .eq('id', actual.id);

    if (errUp) {
      return json({
        error: { message: 'Se generó el texto pero no se pudo guardar: ' + (errUp.message ?? '') , texto },
      }, 500);
    }

    return json({
      ok: true,
      cliente: cliente.nombre,
      mes,
      comparado_con: previo ? mesPrev : null,
      modelo: respuesta.model,
      analisis: texto,
      es_borrador: true,
      regenerado: esBorradorSinRevisar,
      numeros_usados: tabla,
    });
  } catch (e) {
    return json({ error: { message: 'Error inesperado al generar el análisis', detalle: String(e) } }, 500);
  }
});
