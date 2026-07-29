-- ═══════════════════════════════════════════════════════════════════════
--  CoMakers · Ajuste de seguridad (v2)
--  Suma acceso de SUPER ADMIN a las tablas nuevas, además del acceso por cliente.
--  Necesario si tu usuario es super_admin (ve todos los clientes) pero no está
--  en acceso_cliente de cada uno. Correr en SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

drop policy if exists "config_acceso"    on public.cliente_config;
drop policy if exists "contenido_acceso" on public.contenido;

create policy "config_acceso" on public.cliente_config
  for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.super_admin = true)
    or exists (select 1 from public.acceso_cliente ac
               where ac.cliente_id = cliente_config.cliente_id and ac.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.super_admin = true)
    or exists (select 1 from public.acceso_cliente ac
               where ac.cliente_id = cliente_config.cliente_id and ac.user_id = auth.uid())
  );

create policy "contenido_acceso" on public.contenido
  for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.super_admin = true)
    or exists (select 1 from public.acceso_cliente ac
               where ac.cliente_id = contenido.cliente_id and ac.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.super_admin = true)
    or exists (select 1 from public.acceso_cliente ac
               where ac.cliente_id = contenido.cliente_id and ac.user_id = auth.uid())
  );
