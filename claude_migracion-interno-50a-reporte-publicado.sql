-- ═══════════════════════════════════════════════════════════════
--  migracion-interno-50A · reporte_publicado (snapshot) + cierre de
--  escritura del cliente en post_instagram / anuncio_meta
--  08/10/2026
--
--  FASE A de la transición al snapshot. NO le saca al cliente la
--  LECTURA de las tablas vivas (eso es 50B, después de generar los
--  snapshots de lo ya publicado): así ningún cliente deja de ver su
--  reporte ni un rato (el panel cae a lo vivo mientras no haya snapshot).
--
--  Lo que SÍ hace esta migración:
--    1. Crea `reporte_publicado` (el snapshot congelado) + su RLS.
--    2. Cierra un agujero: `post_instagram_acceso` y `anuncio_meta_acceso`
--       eran policies ALL sin rol (todo el mundo), así que el CLIENTE
--       podía INSERT/UPDATE/DELETE en esas dos tablas. Se reemplazan por
--       SELECT-only para el cliente (vía acceso_cliente). La agencia no
--       pierde nada: tiene sus propias policies `_agencia` (ALL).
--
--  reporte_metrica / reporte_destacado quedan para confirmar: dependen
--  de puede_editar_reporte(); si esa función da false para un cliente,
--  no hace falta tocarlas (ver nota al pie).
--
--  Idempotente. Correr en: Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 1 · La tabla del snapshot ───────────────────────────────────
create table if not exists public.reporte_publicado (
  cliente_id    uuid not null references public.clientes(id) on delete cascade,
  mes           date not null,
  snapshot      jsonb not null,
  publicado_en  timestamptz not null default now(),
  publicado_por text,
  primary key (cliente_id, mes)
);

alter table public.reporte_publicado enable row level security;
grant select, insert, update, delete on public.reporte_publicado to authenticated;

-- Cliente: lee SOLO su snapshot (vía acceso_cliente). Super_admin también.
drop policy if exists reporte_publicado_lee on public.reporte_publicado;
create policy reporte_publicado_lee on public.reporte_publicado
  for select to authenticated
  using (
    exists (select 1 from public.profiles p
             where p.id = auth.uid() and p.super_admin = true)
    or exists (select 1 from public.acceso_cliente a
                where a.cliente_id = reporte_publicado.cliente_id and a.user_id = auth.uid())
  );

-- Agencia: escribe y lee todo lo de SUS clientes (mismo patrón que `reporte`).
drop policy if exists reporte_publicado_agencia on public.reporte_publicado;
create policy reporte_publicado_agencia on public.reporte_publicado
  for all to authenticated
  using      (public.es_super() or (public.es_agencia() and public.cliente_de_mi_agencia(cliente_id)))
  with check (public.es_super() or (public.es_agencia() and public.cliente_de_mi_agencia(cliente_id)));


-- ── 2 · Cerrar la escritura del cliente en posts y anuncios ─────
-- Antes: `*_acceso` era ALL sin rol → el cliente escribía/borraba.
-- Ahora: SELECT-only para super o cliente con acceso. La agencia sigue
-- con sus `*_agencia` (ALL), intactas.
drop policy if exists post_instagram_acceso on public.post_instagram;
create policy post_instagram_lee on public.post_instagram
  for select to authenticated
  using (
    exists (select 1 from public.profiles p
             where p.id = auth.uid() and p.super_admin = true)
    or exists (select 1 from public.acceso_cliente ac
                where ac.cliente_id = post_instagram.cliente_id and ac.user_id = auth.uid())
  );

drop policy if exists anuncio_meta_acceso on public.anuncio_meta;
create policy anuncio_meta_lee on public.anuncio_meta
  for select to authenticated
  using (
    exists (select 1 from public.profiles p
             where p.id = auth.uid() and p.super_admin = true)
    or exists (select 1 from public.acceso_cliente ac
                where ac.cliente_id = anuncio_meta.cliente_id and ac.user_id = auth.uid())
  );

commit;

-- ── Verificación ────────────────────────────────────────────────
-- reporte_publicado con RLS y sus dos policies; y post/anuncio con la
-- _lee en SELECT (no ALL) y la _agencia en ALL.
select c.relname as tabla, c.relrowsecurity as rls_on, p.polname as policy,
  case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
       when 'w' then 'UPDATE' when 'd' then 'DELETE' when '*' then 'ALL' end as cmd
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname in ('reporte_publicado', 'post_instagram', 'anuncio_meta')
order by tabla, cmd;
-- Esperado: ninguna policy ALL sin rol sobre post_instagram/anuncio_meta
-- para el cliente; las _lee en SELECT; reporte_publicado con sus 2 policies.

-- ── NOTA (pendiente de confirmar, NO incluido arriba) ───────────
-- reporte_metrica.metrica_edita y reporte_destacado.destacado_edita son
-- ALL con predicado puede_editar_reporte(reporte_id). Si esa función da
-- true para un cliente, el cliente puede escribir métricas/destacados y
-- hay que cerrarlo igual que arriba. Confirmar con:
--   select pg_get_functiondef('public.puede_editar_reporte'::regproc);
