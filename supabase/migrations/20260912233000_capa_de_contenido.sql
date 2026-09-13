-- ============================================================
--  Capa de contenido — hooks, palabras clave y timing
--  12/09/2026
--
--  QUÉ ES: cuatro vistas que calculan, sobre los posts que ya
--  están en post_instagram, la evidencia que hoy no existe en
--  ninguna parte: qué gancho usó cada post y cómo le fue, qué
--  palabras aparecen en los captions que mejor rinden, y a qué
--  hora y qué día se publicó cada cosa.
--
--  QUÉ NO ES: la clasificación en "patrones" (tipo "imperativo
--  con palabra clave en mayúsculas") NO sale de acá. Eso es
--  interpretación y la hace el modelo leyendo estas vistas.
--  SQL prepara la evidencia; la IA la lee.
--
--  NO TOCA META. No hace falta token nuevo ni permisos nuevos:
--  todo sale de columnas que pull-posts ya baja.
--
--  ── SEGURIDAD ──────────────────────────────────────────────
--  Las cuatro llevan `security_invoker = true`. Sin eso, una
--  vista corre con los permisos de quien la creó y SALTEA la
--  RLS de post_instagram: cualquier usuario autenticado podría
--  leer por API los posts de todos los clientes. El trigger de
--  RLS automática cubre tablas nuevas, no vistas.
--  Regla para lo que venga: toda vista sobre una tabla con RLS
--  lleva security_invoker.
-- ============================================================


-- ───────────────────────────────────────────────────────────────
--  0 ── Engagement: UNA sola definición
--
--  ⚠️ OJO: la definición del proyecto vive en panel.html, en la
--  función engagement(). Esta tiene que decir LO MISMO. Si no,
--  el panel y estas vistas van a mostrar números distintos para
--  la misma cosa y nadie va a entender por qué.
--
--  Verificar con:
--    grep -A12 "function engagement" panel.html
--
--  Si difiere, se corrige ACÁ y en un solo lugar.
--
--  Se divide por views y NO por reach a propósito: el reach de
--  cuenta de Meta viene roto de forma intermitente.
-- ───────────────────────────────────────────────────────────────
create or replace function public.engagement_post(
  p_interacciones integer,
  p_views         integer
) returns numeric
language sql
immutable
as $$
  select case
           when coalesce(p_views, 0) = 0 then null
           else round(p_interacciones::numeric / p_views * 1000) / 10
         end;
$$;

comment on function public.engagement_post(integer, integer) is
  'Engagement de un post, en %. Sobre views y no sobre reach: el reach '
  'de cuenta viene roto. DEBE coincidir con engagement() de panel.html.';


-- ───────────────────────────────────────────────────────────────
--  1 ── Base: cada post con su gancho y su hora local
--
--  El "hook" es la primera línea del caption. Es lo que se lee
--  antes del "ver más", o sea lo único que decide si alguien
--  sigue leyendo.
--
--  Todo lo de fecha pasa por America/Argentina/Buenos_Aires.
--  publicado_en es timestamptz: sacar la hora sin convertir
--  devuelve UTC y el "mejor horario" queda corrido 3 horas.
-- ───────────────────────────────────────────────────────────────
create or replace view public.v_post_enriquecido
with (security_invoker = true) as
select
  p.id,
  p.cliente_id,
  p.media_id,
  p.tipo,
  p.mes,
  p.permalink,
  p.thumb_path,
  p.publicado_en,

  -- fecha y hora locales
  (p.publicado_en at time zone 'America/Argentina/Buenos_Aires')            as publicado_local,
  extract(hour from p.publicado_en at time zone 'America/Argentina/Buenos_Aires')::int as hora,
  extract(isodow from p.publicado_en at time zone 'America/Argentina/Buenos_Aires')::int as dia_num,
  (array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'])[
    extract(isodow from p.publicado_en at time zone 'America/Argentina/Buenos_Aires')::int
  ]                                                                         as dia,

  -- el gancho: primera línea, recortada a 100 caracteres
  nullif(btrim(left(split_part(coalesce(p.caption, ''), E'\n', 1), 100)), '') as hook,
  length(coalesce(p.caption, ''))                                            as largo_caption,
  coalesce(p.caption, '') ~ '#'                                              as tiene_hashtags,
  -- ¿el gancho grita? (3+ mayúsculas seguidas, típico "COMENTÁ")
  coalesce(split_part(coalesce(p.caption, ''), E'\n', 1), '') ~ '[[:upper:]]{3,}' as hook_en_mayusculas,

  p.views,
  p.reach,
  p.likes,
  p.comments,
  p.saves,
  p.shares,
  p.interacciones,
  public.engagement_post(p.interacciones, p.views) as engagement,

  -- ¿entra en la ventana de 90 días?
  (p.publicado_en >= now() - interval '90 days')   as en_ventana_90
from public.post_instagram p;

comment on view public.v_post_enriquecido is
  'Cada post con su gancho (primera línea del caption), su hora y día '
  'en horario argentino, y su engagement. Base de las otras tres vistas.';


-- ───────────────────────────────────────────────────────────────
--  2 ── Hooks, ordenados por cómo les fue
--
--  Ventana de 90 días por la misma razón que "rendimiento por
--  formato": con los posts de un mes los promedios se mueven
--  demasiado.
--
--  `percentil` dice en qué lugar quedó ese post contra los otros
--  del mismo cliente: 1.0 es el mejor. Sirve para que el modelo
--  distinga "le fue bien" de "le fue bien para esta cuenta".
-- ───────────────────────────────────────────────────────────────
create or replace view public.v_hooks
with (security_invoker = true) as
select
  e.cliente_id,
  e.media_id,
  e.hook,
  e.tipo,
  e.hook_en_mayusculas,
  e.publicado_local::date as fecha,
  e.views,
  e.interacciones,
  e.saves,
  e.comments,
  e.shares,
  e.engagement,
  e.permalink,
  round(
    percent_rank() over (partition by e.cliente_id order by e.engagement)::numeric
  , 2) as percentil,
  count(*) over (partition by e.cliente_id) as posts_en_ventana
from public.v_post_enriquecido e
where e.en_ventana_90
  and e.hook is not null
  and coalesce(e.views, 0) > 0;

comment on view public.v_hooks is
  'Ganchos de los últimos 90 días con sus números y su percentil dentro '
  'de la cuenta. La clasificación en patrones NO se hace acá: es trabajo '
  'del modelo leyendo esta vista.';


-- ───────────────────────────────────────────────────────────────
--  3 ── Palabras de los captions
--
--  Saca URLs, hashtags, menciones, emojis y números; parte en
--  palabras; descarta las vacías de contenido.
--
--  `engagement_prom` es lo que vale: no interesa qué palabra se
--  repite más, interesa qué palabra aparece en los posts que
--  mejor funcionan. Una palabra con 2 apariciones no dice nada,
--  por eso `veces` viaja al lado y el consumidor filtra.
-- ───────────────────────────────────────────────────────────────
create or replace view public.v_palabras_caption
with (security_invoker = true) as
with limpio as (
  select
    p.cliente_id,
    p.id,
    public.engagement_post(p.interacciones, p.views) as engagement,
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(p.caption, '')),
          'https?://\S+', ' ', 'g'),        -- links
        '[#@]\S+', ' ', 'g'),               -- hashtags y menciones
      '[^[:alpha:][:space:]]', ' ', 'g')    -- todo lo que no sea letra
      as texto
  from public.post_instagram p
  where p.publicado_en >= now() - interval '90 days'
    and coalesce(p.views, 0) > 0
),
palabras as (
  select
    l.cliente_id,
    l.engagement,
    w.palabra
  from limpio l,
       lateral unnest(string_to_array(btrim(l.texto), ' ')) as w(palabra)
  where length(w.palabra) >= 4
    and w.palabra not in (
      'para','pero','como','todo','toda','todos','todas','este','esta','estos',
      'estas','porque','cuando','donde','desde','hasta','sobre','entre','tiene',
      'tienen','hacer','haces','puede','pueden','sino','solo','sola','otro','otra',
      'otros','otras','cada','muy','mas','más','ese','esa','esos','esas','aqui',
      'aquí','alli','allí','ahora','antes','despues','después','tambien','también',
      'nuestro','nuestra','nuestros','nuestras','vamos','estar','estan','están',
      'ser','son','fue','fueron','hay','han','has','con','sin','por','que','los',
      'las','del','una','uno','unos','unas','quien','quienes','cual','cuales',
      'https','http','www','com'
    )
)
select
  cliente_id,
  palabra,
  count(*)                                        as veces,
  round(avg(engagement), 1)                       as engagement_prom,
  round(max(engagement), 1)                       as engagement_max
from palabras
group by cliente_id, palabra
having count(*) >= 2
order by cliente_id, avg(engagement) desc;

comment on view public.v_palabras_caption is
  'Palabras de los captions de los últimos 90 días con el engagement '
  'promedio de los posts donde aparecen. Ordenada por rendimiento, no '
  'por frecuencia. Mirar `veces` antes de sacar conclusiones.';


-- ───────────────────────────────────────────────────────────────
--  4 ── Timing
--
--  Devuelve una fila por cliente y por corte (hora o día), con
--  cuántos posts respaldan cada número. `confiable` marca los
--  que tienen al menos 3, igual que la regla de "rendimiento por
--  formato": abajo de eso se muestra guion, no un número.
--
--  Con 3 posts a las 13h y 1 a las 20h, "la mejor hora es las
--  20" es una conclusión falsa que suena a dato.
-- ───────────────────────────────────────────────────────────────
create or replace view public.v_timing
with (security_invoker = true) as
select
  cliente_id,
  'hora'                    as corte,
  lpad(hora::text, 2, '0') || ':00' as valor,
  hora                      as orden,
  count(*)                  as posts,
  round(avg(engagement), 1) as engagement_prom,
  round(avg(views))         as views_prom,
  count(*) >= 3             as confiable
from public.v_post_enriquecido
where en_ventana_90 and coalesce(views, 0) > 0
group by cliente_id, hora

union all

select
  cliente_id,
  'dia',
  dia,
  dia_num,
  count(*),
  round(avg(engagement), 1),
  round(avg(views)),
  count(*) >= 3
from public.v_post_enriquecido
where en_ventana_90 and coalesce(views, 0) > 0
group by cliente_id, dia, dia_num

order by cliente_id, corte, orden;

comment on view public.v_timing is
  'Rendimiento por hora y por día de la semana, en horario argentino, '
  'ventana de 90 días. `confiable` = al menos 3 posts respaldan el '
  'número. No mostrar los que no lo son.';



-- ============================================================
--  VERIFICACIÓN — correr después, no escribe nada.
-- ============================================================

--  A) ¿Hay material suficiente para que esto diga algo?
select
  c.nombre,
  count(*)                                   as posts_90d,
  count(*) filter (where e.hook is not null) as con_hook,
  round(avg(e.engagement), 1)                as engagement_prom,
  min(e.publicado_local)::date               as desde,
  max(e.publicado_local)::date               as hasta
from public.v_post_enriquecido e
join public.clientes c on c.id = e.cliente_id
where e.en_ventana_90
group by c.nombre
order by 2 desc;

--  B) Los 10 mejores ganchos
select c.nombre, h.fecha, h.tipo, h.engagement, h.percentil, h.hook
  from public.v_hooks h
  join public.clientes c on c.id = h.cliente_id
 order by h.engagement desc nulls last
 limit 10;

--  C) Palabras con mejor rendimiento (mínimo 3 apariciones)
select c.nombre, p.palabra, p.veces, p.engagement_prom
  from public.v_palabras_caption p
  join public.clientes c on c.id = p.cliente_id
 where p.veces >= 3
 order by p.engagement_prom desc
 limit 20;

--  D) Timing, solo lo que tiene respaldo
select c.nombre, t.corte, t.valor, t.posts, t.engagement_prom
  from public.v_timing t
  join public.clientes c on c.id = t.cliente_id
 where t.confiable
 order by c.nombre, t.corte, t.engagement_prom desc;

--  E) La prueba de que la RLS sigue puesta.
--     Las cuatro tienen que dar security_invoker=true.
select c.relname as vista,
       coalesce(
         (select option_value from pg_options_to_table(c.reloptions)
           where option_name = 'security_invoker'), 'NO PUESTO') as security_invoker
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v'
   and c.relname in ('v_post_enriquecido','v_hooks','v_palabras_caption','v_timing')
 order by 1;
