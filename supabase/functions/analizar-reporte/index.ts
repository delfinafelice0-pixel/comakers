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
//  Las métricas que ve el modelo.
//
//  El rótulo es el que usaría una persona, nunca el nombre de la
//  columna — el prompt prohíbe la jerga y no queremos filtrarla por
//  la puerta de atrás.
//
//  La pauta entró acá cuando dejó de cargarse a mano. Antes se
//  excluía porque los números manuales y los de Instagram tenían
//  confiabilidad distinta; ahora los dos vienen de Meta.
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

const METRICAS_ADS: Array<{ col: string; rotulo: string; pesos?: boolean }> = [
  { col: 'inversion_ads',       rotulo: 'Inversión', pesos: true },
  { col: 'resultados_ads',      rotulo: 'Resultados' },
  { col: 'costo_resultado_ads', rotulo: 'Costo por resultado', pesos: true },
  { col: 'reach_ads',           rotulo: 'Alcance de la pauta' },
  { col: 'impresiones_ads',     rotulo: 'Impresiones' },
  { col: 'frecuencia_ads',      rotulo: 'Frecuencia' },
  { col: 'clics_ads',           rotulo: 'Clics' },
  { col: 'ctr_ads',             rotulo: 'CTR' },
];

const ETIQUETA_ACCION: Record<string, string> = {
  'onsite_conversion.total_messaging_connection': 'conversaciones por mensaje',
  'onsite_conversion.messaging_conversation_started_7d': 'conversaciones iniciadas',
  'onsite_conversion.messaging_first_reply': 'primeras respuestas',
  'link_click': 'clics en el enlace',
  'landing_page_view': 'visitas a la web',
  'lead': 'leads',
  'purchase': 'compras',
  'post_engagement': 'interacciones',
  'video_view': 'reproducciones',
};

const COLUMNAS = METRICAS.map((m) => m.col).join(', ');
const COLUMNAS_ADS = METRICAS_ADS.map((m) => m.col).join(', ') + ', accion_ads, moneda_ads';

// "sin dato" y 0 son cosas distintas y el prompt insiste en eso.
// Acá se decide cuál es cuál, una sola vez.
//
// El formato también se decide acá. Si le pasamos 931.702723, el
// modelo escribe "931,7 pesos" y queda raro: los montos en pesos no
// llevan decimales. Lo mismo con los porcentajes, que sin el símbolo
// se leen como si fueran cantidades.
const mostrar = (v: unknown): string =>
  v === null || v === undefined ? 'sin dato' : String(v);

const pesos = (v: unknown): string => {
  if (v === null || v === undefined) return 'sin dato';
  const n = Number(v);
  return isNaN(n) ? 'sin dato' : '$' + Math.round(n).toLocaleString('es-AR');
};

const pct = (v: unknown): string => {
  if (v === null || v === undefined) return 'sin dato';
  const n = Number(v);
  return isNaN(n) ? 'sin dato' : n.toFixed(1).replace('.', ',') + '%';
};

const conDecimal = (v: unknown): string => {
  if (v === null || v === undefined) return 'sin dato';
  const n = Number(v);
  return isNaN(n) ? 'sin dato' : n.toFixed(2).replace('.', ',');
};

const entero = (v: unknown): string => {
  if (v === null || v === undefined) return 'sin dato';
  const n = Number(v);
  return isNaN(n) ? 'sin dato' : Math.round(n).toLocaleString('es-AR');
};

// Cada métrica sabe cómo se escribe.
const FORMATO: Record<string, (v: unknown) => string> = {
  inversion_ads: pesos,
  costo_resultado_ads: pesos,
  ctr_ads: pct,
  frecuencia_ads: conDecimal,
};

function tablaDeNumeros(
  defs: Array<{ col: string; rotulo: string; sangria?: boolean }>,
  actual: any, previo: any | null, mes: string, mesPrev: string,
): string {
  const anchoRot = 28;
  const anchoCol = 12;
  const cab = 'Métrica'.padEnd(anchoRot) +
    etiquetaMes(mes).padStart(anchoCol) +
    (previo ? etiquetaMes(mesPrev).padStart(anchoCol) : '');

  const filas = defs.map((m) => {
    const rot = (m.sangria ? '  ' : '') + m.rotulo;
    const f = FORMATO[m.col] || mostrar;
    return rot.padEnd(anchoRot) +
      f(actual[m.col]).padStart(anchoCol) +
      (previo ? f(previo[m.col]).padStart(anchoCol) : '');
  });

  return [cab, '─'.repeat(cab.length), ...filas].join('\n');
}

// Los captions completos son larguísimos y llenos de emojis. Con el
// arranque alcanza para que el modelo distinga una pieza de otra.
const recorte = (s: string | null, n = 110) => {
  if (!s) return '(sin texto)';
  const limpio = String(s).replace(/\s+/g, ' ').trim();
  return limpio.length > n ? limpio.slice(0, n) + '…' : limpio;
};

const SISTEMA = `Sos analista en una agencia de marketing digital argentina. Escribís el comentario mensual que la agencia le manda a su cliente sobre sus redes.

Reglas:
- Escribí 2 o 3 párrafos corridos. Sin títulos, sin viñetas, sin listas, sin despedida ni firma.
- Español rioplatense, voseo. Tono profesional y cálido, de agencia hablándole a su cliente. Nada de jerga técnica.
- Nunca nombres métricas por su nombre técnico ni menciones tablas, columnas, APIs ni Instagram Insights. Decí "las visualizaciones", "los guardados", "los seguidores nuevos".
- Solo podés usar los números que te paso. No inventes ni estimes ninguno. No calcules nada que no esté en los datos, salvo las variaciones entre los dos meses y los porcentajes que se desprenden directamente de lo que te paso.
- No expliques por qué pasaron las cosas. Podés decir qué cambió y cuánto. No atribuyas causas: no sabés qué pasó en el negocio ni qué hizo la competencia. Frases como "esto se debe a", "gracias al buen contenido" o "el algoritmo" están prohibidas.
- Si una métrica dice "sin dato", decí que ese dato no está disponible este mes. Nunca la trates como cero ni la ignores como si fuera cero. Un cero explícito sí es un cero real y se puede nombrar como tal.
- Si un número subió o bajó mucho, decilo con precisión y sin dramatizar. No lo llames "explosivo", "histórico" ni "preocupante": dado que no podés explicar la causa, tampoco podés saber si es bueno o malo. Describilo y seguí.
- No comprometas acciones de la agencia. No prometas entregables, reuniones, propuestas, informes ni plazos, y no digas qué va a hacer el equipo el mes que viene: eso lo decide la agencia con su cliente, no vos. Podés señalar qué conviene mirar u observar en los próximos meses, en términos de qué números seguir. Frases como "te acercamos la propuesta", "lo vemos juntos en la reunión" o "vamos a trabajar en" están prohibidas.
- Si no hay mes anterior, describí el mes solo, sin comparar y sin mencionar que falta la comparación.

Sobre las publicaciones y los anuncios, cuando te los pase:
- NO los enumeres. Te paso cinco de cada uno para que elijas, no para que los recites. El panel ya muestra la lista completa con sus imágenes justo debajo de tu texto: repetirla en prosa es un bloque de números que nadie lee.
- Mencioná dos, tres como mucho, y solo si hacen a un punto que valga la pena. El caso típico: la pieza que más se llevó y la que mejor rindió, cuando no son la misma.
- Podés señalar cuál tuvo más alcance o cuál costó menos por resultado. Eso es describir lo que muestran los números.
- Lo que NO podés es decir por qué una pieza anduvo mejor. No sabés qué se ve en la imagen ni por qué la gente reaccionó. No digas que "el formato reel conecta mejor" ni que "el copy fue más directo".
- Si un anuncio se llevó una parte grande de la inversión y otro con menos plata trajo resultados más baratos, decilo: es un hecho de los números. Pero no recomiendes mover presupuesto, eso lo decide la agencia.
- Al nombrar una pieza, usá el nombre tal cual te lo paso. No lo reescribas ni lo interpretes.
- Los números te los paso ya escritos como van: los montos con su signo y sin decimales, los porcentajes con su símbolo. Copialos tal cual, no los reformatees ni les agregues decimales.

Sobre el orgánico y la pauta juntos:
- Son dos cosas separadas y sus números no se suman. El alcance del contenido propio y el alcance de la pauta cuentan personas que pueden ser las mismas: sumarlos daría un número falso. Nunca los sumes ni hables de "alcance total".
- Si el cliente tiene los dos, podés comentarlos en párrafos distintos o relacionarlos con cuidado, pero sin afirmar que uno causó lo del otro.`;

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

    // Qué módulos tiene el cliente. Sin fila se asume prendido, que es
    // el contrato que ya usaba el panel.
    const { data: mods } = await admin
      .from('cliente_modulo').select('modulo, activo').eq('cliente_id', clienteId);
    const modulo: Record<string, boolean> = { organico: true, pauta: true };
    (mods ?? []).forEach((m: any) => { if (m.modulo in modulo) modulo[m.modulo] = m.activo !== false; });

    const mesPrev = mesAnterior(mes);
    const { data: filas } = await admin
      .from('reporte')
      .select(`id, mes, analisis, analisis_generado_en, ${COLUMNAS}, ${COLUMNAS_ADS}`)
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
    // Un borrador generado y sin revisar sí se puede regenerar: no hay
    // trabajo humano que perder.
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

    const hayOrg = modulo.organico &&
      METRICAS.some((m) => (actual as any)[m.col] !== null && (actual as any)[m.col] !== undefined);
    const hayAds = modulo.pauta &&
      METRICAS_ADS.some((m) => (actual as any)[m.col] !== null && (actual as any)[m.col] !== undefined);

    if (!hayOrg && !hayAds) {
      return json({
        error: { message: `El reporte de ${etiquetaMes(mes)} no tiene ningún número cargado todavía.` },
      }, 409);
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: { message: 'Falta configurar el acceso a Claude en el servidor.' } }, 500);

    // ── 4. El detalle: publicaciones y anuncios del mes ────────
    // Los totales dicen cuánto; esto dice cuál. Se limita a las
    // primeras para no inflar el prompt: con cinco alcanza para que
    // el modelo distinga una pieza de otra.
    const partes: string[] = [];

    if (hayOrg) {
      partes.push('MÉTRICAS DEL CONTENIDO PROPIO');
      partes.push(tablaDeNumeros(METRICAS, actual, previo, mes, mesPrev));

      const { data: posts } = await admin
        .from('post_instagram')
        .select('tipo, publicado_en, caption, views, reach, likes, comments, saves, shares, interacciones')
        .eq('cliente_id', clienteId).eq('mes', `${mes}-01`)
        .order('reach', { ascending: false, nullsFirst: false })
        .limit(5);

      if (posts && posts.length) {
        partes.push('');
        partes.push(`PUBLICACIONES DEL MES (las ${posts.length} de mayor alcance)`);
        posts.forEach((p: any, i: number) => {
          const d = new Date(p.publicado_en);
          const fecha = isNaN(d.getTime()) ? '' : `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
          partes.push(
            `${i + 1}. ${p.tipo} del ${fecha} — alcance ${mostrar(p.reach)}, ` +
            `visualizaciones ${mostrar(p.views)}, interacciones ${mostrar(p.interacciones)}, ` +
            `guardados ${mostrar(p.saves)}`);
          partes.push(`   texto: ${recorte(p.caption)}`);
        });
      }
    }

    if (hayAds) {
      partes.push('');
      partes.push('MÉTRICAS DE LA PAUTA');
      const et = actual.accion_ads ? (ETIQUETA_ACCION[actual.accion_ads] || 'resultados') : 'resultados';
      partes.push(`Los "resultados" de esta cuenta son ${et}. Nombralos así, no como "resultados".`);
      if (actual.moneda_ads) partes.push(`Los montos están en ${actual.moneda_ads}.`);
      partes.push(tablaDeNumeros(METRICAS_ADS, actual, previo, mes, mesPrev));

      const { data: ads } = await admin
        .from('anuncio_meta')
        .select('nombre, inversion, resultados, costo_resultado, reach, impresiones, ctr')
        .eq('cliente_id', clienteId).eq('mes', `${mes}-01`)
        .order('inversion', { ascending: false, nullsFirst: false })
        .limit(5);

      if (ads && ads.length) {
        const totalInv = ads.reduce((s: number, a: any) => s + (Number(a.inversion) || 0), 0);
        partes.push('');
        partes.push(`ANUNCIOS DEL MES (los ${ads.length} de mayor inversión)`);
        ads.forEach((a: any, i: number) => {
          const share = totalInv > 0
            ? Math.round((Number(a.inversion) || 0) * 100 / totalInv) : null;
          partes.push(
            `${i + 1}. ${a.nombre || '(sin nombre)'} — invirtió ${pesos(a.inversion)}` +
            (share !== null ? ` (${share}% de estos cinco)` : '') +
            `, ${entero(a.resultados)} ${et}, costo ${pesos(a.costo_resultado)} cada uno, ` +
            `CTR ${pct(a.ctr)}`);
        });
      }
    }

    const prompt = [
      `Cliente: ${cliente.nombre}`,
      `Mes del reporte: ${etiquetaMes(mes)}`,
      previo ? `Mes anterior: ${etiquetaMes(mesPrev)}` : 'No hay datos del mes anterior.',
      '',
      partes.join('\n'),
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
    const { error: errUp } = await admin
      .from('reporte')
      .update({ analisis: texto, analisis_generado_en: new Date().toISOString() })
      .eq('id', actual.id);

    if (errUp) {
      return json({
        error: { message: 'Se generó el texto pero no se pudo guardar: ' + (errUp.message ?? ''), texto },
      }, 500);
    }

    return json({
      ok: true,
      cliente: cliente.nombre,
      mes,
      comparado_con: previo ? mesPrev : null,
      modelo: respuesta.model,
      incluyo: { organico: hayOrg, pauta: hayAds },
      analisis: texto,
      es_borrador: true,
      regenerado: esBorradorSinRevisar,
      datos_usados: partes.join('\n'),
    });
  } catch (e) {
    return json({ error: { message: 'Error inesperado al generar el análisis', detalle: String(e) } }, 500);
  }
});
