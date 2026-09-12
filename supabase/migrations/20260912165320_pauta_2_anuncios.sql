-- ═══════════════════════════════════════════════════════════════
--  Pauta · parte 2: el detalle por anuncio
--
--  `reporte` guarda los totales del mes. Esta tabla guarda una fila
--  por anuncio y por mes, que es lo que habilita el "qué creativo
--  funcionó" — la pregunta que el cliente hace de verdad.
--
--  El nombre lleva sufijo por la misma razón que post_instagram: los
--  nombres genéricos ya mordieron una vez en este proyecto.
-- ═══════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.anuncio_meta') is not null then
    raise exception 'public.anuncio_meta ya existe — revisá qué es antes de seguir';
  end if;
end $$;

create table public.anuncio_meta (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.clientes(id) on delete cascade,

  -- El mismo anuncio corre en varios meses con métricas distintas, así
  -- que la clave incluye el mes: no es "un anuncio" sino "un anuncio
  -- en un mes".
  ad_id         text not null,
  mes           date not null,

  nombre        text,
  campania      text,
  conjunto      text,
  estado        text,          -- effective_status de Meta
  permalink     text,          -- link al post promocionado, si lo hay
  thumb_path    text,          -- ruta en el bucket post-thumbs

  inversion       numeric,
  moneda          text,
  resultados      integer,
  accion          text,        -- qué action_type se contó
  costo_resultado numeric,
  reach           integer,
  impresiones     integer,
  frecuencia      numeric,
  clics           integer,
  ctr             numeric,
  cpm             numeric,

  sincronizado_en timestamptz,
  creado_en       timestamptz not null default now(),

  constraint anuncio_meta_cliente_ad_mes_uniq unique (cliente_id, ad_id, mes),
  constraint anuncio_meta_mes_dia_1 check (extract(day from mes) = 1)
);

comment on table  public.anuncio_meta         is 'Un anuncio por mes. Los totales del mes viven en las columnas _ads de reporte.';
comment on column public.anuncio_meta.accion  is 'Qué acción se contó como resultado. Puede diferir del total del mes si el anuncio optimiza otra cosa.';
comment on column public.anuncio_meta.thumb_path is 'Ruta en el bucket post-thumbs, bajo ads/. Las URLs de creativo de Meta vencen; el archivo no.';
comment on column public.anuncio_meta.reach   is 'Alcance del anuncio. NO se suma entre anuncios: la misma persona puede ver varios.';

-- Un solo índice. El unique de arriba ya trae el suyo.
-- El caso real del panel: los anuncios de un cliente en un mes,
-- ordenados por lo que más gastó.
create index anuncio_meta_cliente_mes_idx
  on public.anuncio_meta (cliente_id, mes, inversion desc);

alter table public.anuncio_meta enable row level security;

create policy "anuncio_meta_acceso" on public.anuncio_meta
  for all
  using (
    exists (select 1 from public.profiles p
             where p.id = auth.uid() and p.super_admin = true)
    or exists (select 1 from public.acceso_cliente ac
               where ac.cliente_id = anuncio_meta.cliente_id and ac.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.profiles p
             where p.id = auth.uid() and p.super_admin = true)
    or exists (select 1 from public.acceso_cliente ac
               where ac.cliente_id = anuncio_meta.cliente_id and ac.user_id = auth.uid())
  );

create policy anuncio_meta_agencia on public.anuncio_meta
  for all to authenticated
  using      ( public.es_super() or (public.es_agencia() and public.cliente_de_mi_agencia(cliente_id)) )
  with check ( public.es_super() or (public.es_agencia() and public.cliente_de_mi_agencia(cliente_id)) );

select 'anuncio_meta creada · ' ||
       (select count(*) from pg_indexes where schemaname='public' and tablename='anuncio_meta') || ' índices · ' ||
       (select count(*) from pg_policy pol join pg_class c on c.oid=pol.polrelid
         where c.relname='anuncio_meta') || ' policies' as resultado;
