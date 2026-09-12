-- ═══════════════════════════════════════════════════════════════
--  Pauta de Meta · parte 1: la base
--
--  Tres cosas que van juntas:
--    1. Las columnas donde el pull de ads escribe los totales del mes
--    2. `cliente_modulo` como única verdad de qué reporta cada cliente
--    3. Qué acción de Meta cuenta como "resultado" para cada cliente
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────
--  1 ── Totales de pauta en `reporte`
--
--  Sufijo _ads, igual que ya existen las _org. NO se tocan las
--  columnas viejas `inversion`, `conversiones`, `alcance` y
--  `engagement`: son de la primera versión del reporte y las cargaba
--  una persona a mano. Si el pull escribiera ahí, pisaría trabajo
--  humano sin forma de distinguirlo después.
-- ───────────────────────────────────────────────────────────────
alter table public.reporte
  add column if not exists inversion_ads        numeric,
  add column if not exists moneda_ads           text,
  add column if not exists resultados_ads       integer,
  add column if not exists accion_ads           text,
  add column if not exists costo_resultado_ads  numeric,
  add column if not exists reach_ads            integer,
  add column if not exists impresiones_ads      integer,
  add column if not exists frecuencia_ads       numeric,
  add column if not exists clics_ads            integer,
  add column if not exists ctr_ads              numeric,
  add column if not exists cpm_ads              numeric,
  add column if not exists ads_sincronizado_en  timestamptz;

comment on column public.reporte.accion_ads is
  'Qué acción de Meta se contó como resultado (ej. onsite_conversion.total_messaging_connection). Sin esto, "resultados: 19" no dice resultados de qué.';
comment on column public.reporte.ads_sincronizado_en is
  'Marca propia del pull de ads. Separada de sincronizado_en porque son dos pulls distintos: si uno pisara la marca del otro, el rótulo "Traído de Instagram el…" pasaría a mentir.';
comment on column public.reporte.reach_ads is
  'Alcance de la pauta. NO se suma con reach_org: contaría dos veces a quien vio un post y un anuncio. Meta no expone el alcance unificado de las dos fuentes.';


-- ───────────────────────────────────────────────────────────────
--  2 ── Qué acción cuenta como "resultado"
--
--  Meta no tiene una métrica "resultados": devuelve un arreglo de
--  acciones y cada campaña optimiza una distinta. Mezclar mensajes
--  con clics daría un número sin sentido.
--
--  Null = el pull usa mensajes, que es lo que corren los clientes de
--  hoy, y lo deja anotado en reporte.accion_ads.
-- ───────────────────────────────────────────────────────────────
alter table public.cliente_integracion
  add column if not exists accion_principal text;

comment on column public.cliente_integracion.accion_principal is
  'Qué action_type de Meta contar como resultado para este cliente. Null = mensajes (default). Cambiar solo si la cuenta optimiza a otra cosa.';


-- ───────────────────────────────────────────────────────────────
--  3 ── `cliente_modulo` pasa a ser la única verdad
--
--  Hoy hay tres cosas que deciden lo mismo: clientes.rep_organico /
--  rep_pauta, esta tabla, y de hecho si hay métricas cargadas. La
--  tabla está vacía, así que el panel asume "sin fila = prendido".
--
--  Eso deja de alcanzar cuando el panel filtre de verdad: los 25
--  clientes mostrarían una sección Pauta vacía. Se llena de una vez
--  con lo que ya dicen las columnas viejas.
-- ───────────────────────────────────────────────────────────────
insert into public.cliente_modulo (cliente_id, modulo, activo)
select c.id, 'organico', coalesce(c.rep_organico, true) from public.clientes c
union all
select c.id, 'pauta',    coalesce(c.rep_pauta, false)   from public.clientes c
on conflict (cliente_id, modulo) do nothing;

-- Los clientes nuevos nacen con sus filas. Sin esto, cada cliente
-- creado desde administración volvería al "sin fila" y el panel
-- tendría que adivinar otra vez.
create or replace function public.cliente_modulo_por_defecto()
returns trigger
language plpgsql
as $$
begin
  insert into public.cliente_modulo (cliente_id, modulo, activo)
  values (new.id, 'organico', coalesce(new.rep_organico, true)),
         (new.id, 'pauta',    coalesce(new.rep_pauta, false))
  on conflict (cliente_id, modulo) do nothing;
  return new;
end $$;

drop trigger if exists cliente_modulo_por_defecto_trg on public.clientes;
create trigger cliente_modulo_por_defecto_trg
  after insert on public.clientes
  for each row execute function public.cliente_modulo_por_defecto();

-- Las columnas viejas quedan, pero marcadas. No las borro todavía:
-- si algo que no vi las usa, borrarlas rompería en silencio.
comment on column public.clientes.rep_organico is
  'OBSOLETA. La verdad vive en cliente_modulo. Se mantiene solo hasta confirmar que nada más la lee.';
comment on column public.clientes.rep_pauta is
  'OBSOLETA. La verdad vive en cliente_modulo. pull-instagram tiene que leer cliente_modulo, no esto.';


-- ───────────────────────────────────────────────────────────────
--  4 ── Confirmación
-- ───────────────────────────────────────────────────────────────
select
  (select count(*) from public.cliente_modulo where modulo = 'organico' and activo) as con_organico,
  (select count(*) from public.cliente_modulo where modulo = 'pauta' and activo)    as con_pauta,
  (select count(*) from public.clientes)                                            as clientes,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'reporte'
      and column_name like '%\_ads')                                                as columnas_ads;
