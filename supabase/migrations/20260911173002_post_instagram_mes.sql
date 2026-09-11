-- ═══════════════════════════════════════════════════════════════
--  post_instagram · columna `mes`
--
--  `publicado_en` es el instante exacto, en timestamptz. Filtrar un
--  mes con eso obliga a calcular los bordes en hora de Buenos Aires
--  en cada consulta del panel, y equivocarse es silencioso: un post
--  del 31 de agosto a las 22:00 en BA es 1 de septiembre en UTC, y
--  se te va al mes de al lado sin que nada avise.
--
--  `mes` guarda ese recorte hecho una sola vez, en el pull, con la
--  misma lógica de zona horaria que usa el reporte mensual
--  (_shared/fechas.ts). El panel filtra por igualdad y no puede
--  equivocarse. Además junta directo con `reporte.mes`, que es date
--  y también apunta al día 1.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. La tabla tiene que estar vacía ────────────────────────────
-- `not null` sin default solo es seguro si no hay filas. Si alguien
-- ya cargó posts, esto para acá y lo miramos juntas en vez de
-- inventar un backfill a ciegas.
do $$
declare n bigint;
begin
  select count(*) into n from public.post_instagram;
  if n > 0 then
    raise exception 'post_instagram tiene % filas: hay que backfillear `mes` antes de ponerla not null', n;
  end if;
end $$;


-- ── 2. La columna ────────────────────────────────────────────────
alter table public.post_instagram
  add column mes date not null;

-- Atrapa el error de escribir la fecha completa en vez del mes
-- recortado. Sin esto, un bug del pull pasa desapercibido hasta que
-- el panel no encuentra nada y no se entiende por qué.
alter table public.post_instagram
  add constraint post_instagram_mes_dia_1
  check (extract(day from mes) = 1);

comment on column public.post_instagram.mes is
  'Primer día del mes de publicación, recortado en America/Argentina/Buenos_Aires por el pull. Junta con reporte.mes. No derivar de publicado_en en SQL: el recorte en UTC corre los posts de fin de mes.';


-- ── 3. Un índice en lugar de dos ─────────────────────────────────
-- El viejo era (cliente_id, publicado_en desc). Sumar (cliente_id,
-- mes) dejaría dos índices con el mismo prefijo — lo que ya pasó con
-- `reporte`. Este cubre el caso real del panel: los posts de un
-- cliente en un mes, ordenados del más nuevo al más viejo.
drop index if exists public.post_instagram_cliente_fecha_idx;

create index post_instagram_cliente_mes_idx
  on public.post_instagram (cliente_id, mes, publicado_en desc);


-- ── 4. Confirmación ──────────────────────────────────────────────
select 'mes agregada · ' ||
       (select count(*) from pg_indexes
         where schemaname = 'public' and tablename = 'post_instagram') ||
       ' índices (esperado 3: pk, unique, cliente_mes)' as resultado;
