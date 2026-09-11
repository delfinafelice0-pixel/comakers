-- ═══════════════════════════════════════════════════════════════
--  Posts individuales de Instagram
--
--  Hasta ahora `reporte` guarda totales del mes. Esta tabla guarda
--  una fila por pieza publicada, que es lo que habilita top posts,
--  rendimiento por formato y análisis de patrones.
--
--  El nombre lleva el sufijo porque `post` a secas ya está tomado en
--  esta base por otra tabla que no es nuestra.
--
--  Qué NO guarda, a propósito:
--    · engagement — es derivado. La fórmula vive en un solo lugar del
--      código (panel.html) para poder revisarla de una sola vez.
--      Ver el comentario de `engagement()` allá: hoy se calcula sobre
--      views y no sobre reach, porque el reach de Meta viene fallando.
--    · historias — vencen a las 24 h y no salen por /media. Necesitan
--      un job diario que todavía no existe. PENDIENTE.
-- ═══════════════════════════════════════════════════════════════

create table public.post_instagram (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.clientes(id) on delete cascade,

  -- El id de Meta. Único por cliente, no global: si alguna vez la
  -- misma cuenta de Instagram se conecta a dos clientes (una cuenta
  -- de prueba, una marca que migra), un índice global haría que el
  -- segundo cliente le robe las filas al primero.
  media_id      text not null,

  -- 'historia' queda reservado para cuando exista el job diario.
  -- Hoy el pull mensual nunca lo escribe.
  tipo          text not null
                check (tipo in ('reel', 'carrusel', 'imagen', 'video', 'historia')),

  publicado_en  timestamptz not null,
  caption       text,
  permalink     text,
  thumb_path    text,

  -- Crudo de Meta. Cualquiera puede venir null: el endpoint de
  -- insights es intermitente y un null significa "no sabemos",
  -- nunca cero.
  views         integer,
  reach         integer,
  likes         integer,
  comments      integer,
  saves         integer,
  shares        integer,
  interacciones integer,

  sincronizado_en timestamptz,
  creado_en     timestamptz not null default now(),

  constraint post_instagram_cliente_media_uniq unique (cliente_id, media_id)
);

-- CAMBIO 1 · sin `if not exists`, para que grite si el nombre ya está
-- tomado en vez de tragárselo en silencio (lo de los tres índices
-- duplicados sobre `reporte`).
create index post_instagram_cliente_fecha_idx
  on public.post_instagram (cliente_id, publicado_en desc);

comment on column public.post_instagram.thumb_path is
  'Ruta en el bucket post-thumbs, no una URL. Se firma al renderizar.';
comment on column public.post_instagram.reach is
  'Crudo de Meta. Poco confiable: ver el comentario del guardián de alcance en pull-instagram.';

-- ── RLS: mismo patrón que cliente_config y contenido ──────────
-- super_admin ve todo; el resto, lo que tenga en acceso_cliente.
alter table public.post_instagram enable row level security;

drop policy if exists "post_instagram_acceso" on public.post_instagram;

create policy "post_instagram_acceso" on public.post_instagram
  for all
  using (
    exists (select 1 from public.profiles p
             where p.id = auth.uid() and p.super_admin = true)
    or exists (select 1 from public.acceso_cliente ac
               where ac.cliente_id = post_instagram.cliente_id and ac.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.profiles p
             where p.id = auth.uid() and p.super_admin = true)
    or exists (select 1 from public.acceso_cliente ac
               where ac.cliente_id = post_instagram.cliente_id and ac.user_id = auth.uid())
  );

-- CAMBIO 2 · Clonada de `reporte_agencia`, que es como entra hoy la
-- gente de la agencia a las métricas del cliente. Sin esto, alguien
-- con rol de agencia pero sin fila en `acceso_cliente` ve `reporte`
-- pero no ve los posts, y no se entiende por qué.
-- Las policies se suman entre sí (OR), así que esto no le saca acceso
-- a nadie. Si preferís no tenerla, borrá este bloque y listo.
drop policy if exists post_instagram_agencia on public.post_instagram;

create policy post_instagram_agencia on public.post_instagram
  for all to authenticated
  using      ( public.es_super() or (public.es_agencia() and public.cliente_de_mi_agencia(cliente_id)) )
  with check ( public.es_super() or (public.es_agencia() and public.cliente_de_mi_agencia(cliente_id)) );
