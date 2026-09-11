// ═══════════════════════════════════════════════════════════════
//  Edge Function · pull-posts
//  Trae los posts publicados en un mes y los escribe en
//  `post_instagram`, con su miniatura en el bucket privado.
//
//  Va aparte de pull-instagram a propósito: el pull mensual es una
//  sola escritura rápida, esto son N llamadas a insights más N
//  descargas de imágenes. Juntas, un timeout bajando una miniatura
//  dejaría el reporte del mes a medio escribir.
//
//  Deploy:
//    supabase functions deploy pull-posts
//  Usa el mismo secret que pull-instagram:
//    META_TOKEN
//
//  Body:  { cliente_id: "uuid", mes?: "2026-08" }
//  El ig_user_id NUNCA llega por el body: sale de cliente_integracion.
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS, json, graph, ErrorMeta, esFatal, cuota, V } from '../_shared/meta.ts';
import { bordesDelMes, mesActualEnBA } from '../_shared/fechas.ts';
import { evaluarAlcance } from '../_shared/alcance.ts';

const BUCKET = 'post-thumbs';

// Tope duro. Una pyme publica 10 o 20 posts al mes; si alguna vez
// esto se acerca a 200, es un bug de paginación, no una cuenta muy
// activa. Prefiero cortar y avisar antes que quedarme colgada.
const MAX_POSTS = 200;
const POR_PAGINA = 50;

const CAMPOS_MEDIA = [
  'id',
  'media_type',
  'media_product_type',
  'caption',
  'permalink',
  'timestamp',
  'thumbnail_url',
  'media_url',
  'children{media_url,thumbnail_url}',
].join(',');

// ─────────────────────────────────────────────────────────────
//  Métricas de post. `col` es la columna de la tabla.
//
//  Ojo con `saved`: a nivel cuenta la métrica se llama `saves`, a
//  nivel post históricamente fue `saved` y Meta viene renombrándola.
//  Por eso lleva alternativa: si la primera no existe, se prueba la
//  otra antes de darla por perdida.
// ─────────────────────────────────────────────────────────────
const METRICAS = [
  { meta: 'views', col: 'views', alt: [] as string[] },
  { meta: 'reach', col: 'reach', alt: [] as string[] },
  { meta: 'likes', col: 'likes', alt: [] as string[] },
  { meta: 'comments', col: 'comments', alt: [] as string[] },
  { meta: 'saved', col: 'saves', alt: ['saves'] },
  { meta: 'shares', col: 'shares', alt: [] as string[] },
  { meta: 'total_interactions', col: 'interacciones', alt: [] as string[] },
];

// Los insights de un post devuelven values[0].value, no total_value
// como los de cuenta. Aceptamos las dos formas por las dudas.
function valorMedia(body: any, nombre: string): number | null {
  const fila = (body?.data ?? []).find((d: any) => d.name === nombre);
  if (!fila) return null;
  const directo = fila?.total_value?.value;
  if (typeof directo === 'number') return directo;
  const v = fila?.values?.[0]?.value;
  return typeof v === 'number' ? v : null;
}

// REELS y VIDEO quedan separados en la base aunque el panel los
// muestre juntos: si Meta algún día los distingue de verdad, el dato
// crudo ya está guardado y no hay que volver a traerlo.
function clasificar(m: any): string | null {
  const producto = String(m?.media_product_type ?? '').toUpperCase();
  const tipo = String(m?.media_type ?? '').toUpperCase();
  if (producto === 'STORY') return null;   // vencen a las 24h, no salen por /media
  if (producto === 'REELS') return 'reel';
  if (tipo === 'CAROUSEL_ALBUM') return 'carrusel';
  if (tipo === 'VIDEO') return 'video';
  if (tipo === 'IMAGE') return 'imagen';
  return 'imagen';
}

// El carrusel no trae imagen propia: hay que mirar el primer hijo.
function urlMiniatura(m: any): string | null {
  const tipo = String(m?.media_type ?? '').toUpperCase();
  if (tipo === 'CAROUSEL_ALBUM') {
    const hijo = m?.children?.data?.[0];
    return hijo?.thumbnail_url ?? hijo?.media_url ?? null;
  }
  if (tipo === 'VIDEO') return m?.thumbnail_url ?? null;
  return m?.media_url ?? m?.thumbnail_url ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  let integracionId: string | null = null;
  let admin: any = null;

  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: { code: null, message: 'Sin sesión' } }, 401);

    let body: any = {};
    try { body = await req.json(); } catch { /* body vacío */ }

    const clienteId = body?.cliente_id ? String(body.cliente_id) : null;
    if (!clienteId) return json({ error: { code: null, message: 'Falta el cliente' } }, 400);

    const mes = body?.mes ? String(body.mes).slice(0, 7) : mesActualEnBA();
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return json({ error: { code: null, message: 'El mes tiene que venir como AAAA-MM' } }, 400);
    }
    const mesFecha = `${mes}-01`;

    // ── 1. Quién llama: RLS decide, no un if nuestro ──────────
    const llamador = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: cliente, error: errCliente } = await llamador
      .from('clientes')
      .select('id, nombre')
      .eq('id', clienteId)
      .maybeSingle();

    if (errCliente) {
      return json({ error: { code: null, message: 'No se pudo verificar el acceso al cliente' } }, 500);
    }
    if (!cliente) {
      return json({ error: { code: null, message: 'No tenés acceso a este cliente' } }, 403);
    }

    // ── 2. Service role: de acá en adelante, solo para escribir ──
    admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: integ } = await admin
      .from('cliente_integracion')
      .select('id, cuenta_id')
      .eq('cliente_id', clienteId)
      .eq('tipo', 'meta_ig')
      .eq('activo', true)
      .maybeSingle();

    if (!integ?.cuenta_id) {
      return json({
        error: {
          code: null,
          message: `${cliente.nombre} todavía no tiene una cuenta de Instagram conectada. Cargala en Configuración.`,
        },
      }, 409);
    }
    integracionId = integ.id;
    const igId = String(integ.cuenta_id);

    const token = Deno.env.get('META_TOKEN');
    if (!token) {
      return json({ error: { code: null, message: 'Falta configurar el acceso a Meta en el servidor.' } }, 500);
    }

    const { desde, hasta } = bordesDelMes(mes);
    if (hasta <= desde) {
      return json({ error: { code: null, message: 'Ese mes todavía no empezó.' } }, 400);
    }

    const notas: string[] = [];
    const fallos: Record<string, string> = {};

    // ── 3. Qué miniaturas ya tenemos ──────────────────────────
    // Las URLs de Meta vencen en horas, pero el archivo del bucket
    // no. Si ya la bajamos, re-correr el mes no vuelve a bajarla.
    const { data: previas } = await admin
      .from('post_instagram')
      .select('media_id, thumb_path')
      .eq('cliente_id', clienteId)
      .eq('mes', mesFecha);

    const thumbsQueYaTengo = new Map<string, string>();
    for (const p of previas ?? []) {
      if (p.thumb_path) thumbsQueYaTengo.set(String(p.media_id), String(p.thumb_path));
    }

    // ═══════════════════════════════════════════════════════════
    //  MODO DIAGNÓSTICO  ·  body { debug: true }
    //  Temporal: pide la primera página de /media y la devuelve
    //  cruda, sin filtrar por fecha y sin escribir nada en la base.
    //  Sacar cuando se entienda por qué julio y agosto dieron cero.
    // ═══════════════════════════════════════════════════════════
    if (body?.debug === true) {
      const diag: Record<string, unknown> = {
        mes,
        ventana: {
          desde_ms: desde,
          hasta_ms: hasta,
          desde_iso: new Date(desde).toISOString(),
          hasta_iso: new Date(hasta).toISOString(),
          dias: Math.round((hasta - desde) / 86400000),
        },
        ig_user_id: igId,
      };

      // (a) La cuenta responde? Campos mínimos, sin insights.
      try {
        diag.cuenta = await graph(`/${igId}?fields=id,username,media_count`, token);
      } catch (err) {
        diag.cuenta_error = err instanceof ErrorMeta ? err.aJSON() : String(err);
      }

      // (b) /media con todos los campos que pide la función.
      const qsCompleta = `fields=${CAMPOS_MEDIA}&limit=${POR_PAGINA}`;
      diag.url_completa = `/${igId}/media?${qsCompleta}`;
      try {
        const p = await graph(`/${igId}/media?${qsCompleta}`, token);
        const items = p?.data ?? [];
        diag.media_completa = {
          cantidad: items.length,
          tiene_paging_next: Boolean(p?.paging?.next),
          cursor_after: p?.paging?.cursors?.after ?? null,
          primeros_10: items.slice(0, 10).map((m: any) => ({
            id: m.id,
            timestamp: m.timestamp,
            parseado_ms: Date.parse(m.timestamp ?? ''),
            cae_en_la_ventana:
              Date.parse(m.timestamp ?? '') >= desde && Date.parse(m.timestamp ?? '') < hasta,
            media_type: m.media_type,
            media_product_type: m.media_product_type,
            clasificado_como: clasificar(m),
            tiene_thumb: Boolean(urlMiniatura(m)),
          })),
        };
      } catch (err) {
        diag.media_completa_error = err instanceof ErrorMeta ? err.aJSON() : String(err);
      }

      // (c) /media pelada. Si esta anda y la de arriba no, el
      //     problema es alguno de los campos que estoy pidiendo.
      try {
        const p = await graph(`/${igId}/media?fields=id,timestamp&limit=5`, token);
        diag.media_minima = {
          cantidad: (p?.data ?? []).length,
          crudo: p,
        };
      } catch (err) {
        diag.media_minima_error = err instanceof ErrorMeta ? err.aJSON() : String(err);
      }

      return json({
        ok: true,
        modo: 'diagnostico — no se escribió nada en la base',
        version_api: V,
        ...diag,
        cuota: cuota(),
      });
    }

    // ── 4. Recorrer /media hasta salir del mes ────────────────
    // Meta acepta since/until acá pero los respeta mal. Más confiable
    // es pedir las páginas en orden descendente (el default) y cortar
    // cuando la fecha cae antes del inicio del mes.
    const delMes: any[] = [];
    let cursor: string | null = null;
    let vistos = 0;
    let cortePorTope = false;

    paginado: while (true) {
      const qs = `fields=${CAMPOS_MEDIA}&limit=${POR_PAGINA}` + (cursor ? `&after=${cursor}` : '');
      const pagina = await graph(`/${igId}/media?${qs}`, token);
      const items = pagina?.data ?? [];
      if (!items.length) break;

      for (const m of items) {
        vistos++;
        if (vistos > MAX_POSTS) { cortePorTope = true; break paginado; }

        const t = Date.parse(m?.timestamp ?? '');
        if (!Number.isFinite(t)) continue;
        if (t >= hasta) continue;   // todavía no llegamos al mes
        if (t < desde) break paginado;  // ya lo pasamos: vienen en orden

        const tipo = clasificar(m);
        if (!tipo) continue;        // historias
        delMes.push({ ...m, _tipo: tipo, _ts: t });
      }

      cursor = pagina?.paging?.cursors?.after ?? null;
      if (!cursor || !pagina?.paging?.next) break;
    }

    if (cortePorTope) {
      notas.push(`Se cortó en ${MAX_POSTS} publicaciones revisadas. Si el mes tenía más, faltan.`);
    }

    if (!delMes.length) {
      await admin.from('cliente_integracion')
        .update({ ultimo_sync: new Date().toISOString(), ultimo_error: null })
        .eq('id', integracionId);
      return json({
        ok: true, cliente: cliente.nombre, mes, version_api: V,
        posts_encontrados: 0, posts_escritos: 0,
        notas: [...notas, 'No hay publicaciones en ese mes.'],
        cuota: cuota(),
      });
    }

    // ── 5. Insights y miniatura, post por post ────────────────
    // Secuencial a propósito: 20 posts no justifican pelearse con el
    // rate limit de Meta por ahorrar unos segundos.
    const filas: Record<string, unknown>[] = [];
    let alcancesDescartados = 0;
    let thumbsNuevas = 0, thumbsFallidas = 0, thumbsReusadas = 0;
    const postsConInsightsRotos: string[] = [];

    for (const m of delMes) {
      const mediaId = String(m.id);
      const metricas: Record<string, number | null> = {};

      // (a) Insights. Una llamada agrupada; si Meta rechaza alguna
      //     métrica tira #100 y se cae toda, así que reintentamos de
      //     a una para no perder el resto por culpa de una sola.
      //     Mismo patrón que pull-instagram.
      let agrupada: any = null;
      try {
        const lista = METRICAS.map((x) => x.meta).join(',');
        agrupada = await graph(`/${mediaId}/insights?metric=${lista}`, token);
      } catch (e) {
        if (esFatal(e)) throw e;
        agrupada = null;
      }

      if (agrupada) {
        for (const x of METRICAS) metricas[x.col] = valorMedia(agrupada, x.meta);
      } else {
        let algunaAndubo = false;
        for (const x of METRICAS) {
          let valor: number | null = null;
          for (const nombre of [x.meta, ...x.alt]) {
            try {
              const uno = await graph(`/${mediaId}/insights?metric=${nombre}`, token);
              valor = valorMedia(uno, nombre);
              if (valor !== null) { algunaAndubo = true; break; }
            } catch (e) {
              if (esFatal(e)) throw e;
            }
          }
          metricas[x.col] = valor;
        }
        if (!algunaAndubo) postsConInsightsRotos.push(mediaId);
      }

      // (b) Guardián del alcance, el mismo que el mensual.
      //     Ver _shared/alcance.ts: null es "no sabemos", nunca 0.
      const veredicto = evaluarAlcance(metricas.reach ?? null, metricas.views ?? null);
      if (veredicto.descartado) alcancesDescartados++;
      metricas.reach = veredicto.reach;

      // (c) Miniatura. Nunca frena el pull: si falla, thumb_path
      //     queda null y el panel muestra un placeholder.
      let thumbPath: string | null = thumbsQueYaTengo.get(mediaId) ?? null;
      if (thumbPath) {
        thumbsReusadas++;
      } else {
        const url = urlMiniatura(m);
        if (url) {
          try {
            const img = await fetch(url);
            if (!img.ok) throw new Error(`HTTP ${img.status}`);
            const bytes = new Uint8Array(await img.arrayBuffer());
            const ruta = `${clienteId}/${mediaId}.jpg`;
            const { error: errUp } = await admin.storage
              .from(BUCKET)
              .upload(ruta, bytes, {
                contentType: img.headers.get('content-type') ?? 'image/jpeg',
                upsert: true,
              });
            if (errUp) throw new Error(errUp.message ?? 'error de storage');
            thumbPath = ruta;
            thumbsNuevas++;
          } catch (_e) {
            thumbsFallidas++;
          }
        } else {
          thumbsFallidas++;
        }
      }

      filas.push({
        cliente_id: clienteId,
        media_id: mediaId,
        tipo: m._tipo,
        publicado_en: new Date(m._ts).toISOString(),
        mes: mesFecha,
        caption: m.caption ?? null,
        permalink: m.permalink ?? null,
        thumb_path: thumbPath,
        views: metricas.views ?? null,
        reach: metricas.reach ?? null,
        likes: metricas.likes ?? null,
        comments: metricas.comments ?? null,
        saves: metricas.saves ?? null,
        shares: metricas.shares ?? null,
        interacciones: metricas.interacciones ?? null,
        sincronizado_en: new Date().toISOString(),
      });
    }

    // ── 6. Upsert de todo junto ───────────────────────────────
    const { error: errUp } = await admin
      .from('post_instagram')
      .upsert(filas, { onConflict: 'cliente_id,media_id' });

    if (errUp) {
      const falta = String(errUp.code) === '42P10' || /ON CONFLICT/i.test(errUp.message ?? '');
      const msg = falta
        ? 'Falta el índice único (cliente_id, media_id) en post_instagram. Sin eso no se puede guardar sin duplicar.'
        : 'No se pudieron guardar los posts: ' + (errUp.message ?? 'error de base');
      await admin.from('cliente_integracion')
        .update({ ultimo_error: `${mes} · posts · ${msg}`, ultimo_sync: null })
        .eq('id', integracionId);
      return json({ error: { code: errUp.code ?? null, message: msg } }, 500);
    }

    // ── 7. Dejar rastro de lo que salió a medias ──────────────
    // Misma codificación que pull-instagram: ultimo_sync con fecha y
    // ultimo_error con texto significa "terminó, pero con faltantes".
    if (alcancesDescartados) {
      fallos['alcance'] = `${alcancesDescartados} de ${filas.length} posts con alcance descartado por inconsistente`;
    }
    if (postsConInsightsRotos.length) {
      fallos['insights'] = `${postsConInsightsRotos.length} posts sin ninguna métrica`;
    }
    if (thumbsFallidas) {
      fallos['miniaturas'] = `${thumbsFallidas} miniaturas no se pudieron guardar`;
    }

    const faltantes = Object.keys(fallos);
    const resumen = faltantes.length
      ? `${mes} · posts sincronizados con faltantes · ` +
        faltantes.map((k) => `${k}: ${fallos[k]}`).join(' · ')
      : null;

    await admin.from('cliente_integracion')
      .update({ ultimo_sync: new Date().toISOString(), ultimo_error: resumen })
      .eq('id', integracionId);

    return json({
      ok: true,
      cliente: cliente.nombre,
      mes,
      version_api: V,
      publicaciones_revisadas: vistos,
      posts_encontrados: delMes.length,
      posts_escritos: filas.length,
      por_tipo: filas.reduce((a: Record<string, number>, f: any) => {
        a[f.tipo] = (a[f.tipo] ?? 0) + 1; return a;
      }, {}),
      alcances_descartados: alcancesDescartados,
      miniaturas: { nuevas: thumbsNuevas, reusadas: thumbsReusadas, fallidas: thumbsFallidas },
      faltantes: fallos,
      notas,
      cuota: cuota(),
    });
  } catch (e) {
    const err = e instanceof ErrorMeta
      ? e.aJSON()
      : { code: null, subcode: null, message: 'Error inesperado al traer los posts', detalle: String(e) };

    if (admin && integracionId) {
      await admin.from('cliente_integracion')
        .update({ ultimo_error: err.message, ultimo_sync: null })
        .eq('id', integracionId);
    }
    const status = err.code === 190 || err.code === 368 ? 403 : 502;
    return json({ error: err }, status);
  }
});
