-- ═══════════════════════════════════════════════════════════════
--  Prueba de la 47 · RLS de cliente_whatsapp
--  07/10/2026
--
--  Corre contra Supabase (SQL Editor), NO contra un Postgres local.
--  Prueba POLICIES, no una función, así que impersona con rol
--  authenticated + JWT (las policies solo actúan así). El atajo de
--  set_config('prueba.actor', …) que usa prueba-45 no sirve acá: ese
--  lo entiende puede_ver_tarea, no la RLS.
--
--  Tres casos:
--    1. La agencia A ve el mapeo de SU cliente y no el de la agencia B.
--    2. Un usuario cliente (con acceso_cliente) NO ve nada de
--       cliente_whatsapp, ni el suyo.
--    3. Dos clientes no pueden tener el mismo phone_number_id (unique).
--
--  Los tres veredictos van a una temp table y hay UN SOLO select al
--  final: el SQL Editor solo muestra la salida de la última sentencia,
--  así se ven los tres juntos.
--
--  Todo lo de prueba lleva prefijo reconocible: uuid cccc0000-… ,
--  clientes.slug prueba47-… , phone_number_id prueba47-… . Se limpia
--  con DELETE por esos prefijos al final (no rollback).
--
--  Fixtures confirmadas al correrla: profiles.id referencia
--  auth.users (se seedea primero) y un trigger crea la fila de
--  profiles al insertar el usuario (por eso profiles va con
--  on conflict do update). mi_agencia() lee profiles.agencia contra
--  clientes.agencia.
-- ═══════════════════════════════════════════════════════════════

-- ── Impersonación (patrón de las pruebas de policies) ────────────
create or replace function como(quien uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', quien::text, 'role', 'authenticated')::text,
    true);
end $$;

create or replace function volver() returns void
language plpgsql as $$
begin perform set_config('role', 'postgres', true); end $$;

-- ── Resultados ───────────────────────────────────────────────────
-- Temp table con los veredictos. grant a authenticated porque los
-- casos 1 y 2 insertan acá mientras impersonan ese rol.
create temp table resultado_prueba47 (caso text, veredicto text) on commit drop;
grant all on resultado_prueba47 to authenticated;

-- ── Fixtures ─────────────────────────────────────────────────────
-- profiles.id referencia auth.users(id), así que primero hay que crear
-- los usuarios. BLOQUE REUSABLE para prueba-46: copialo tal cual y
-- cambiá los uuids y los emails. Son los mínimos NOT NULL razonables
-- (instance_id, aud, role, email, encrypted_password, created/updated).
-- Los emails usan .invalid (TLD reservado, nunca real).
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'cccc0000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'prueba47-aga@ejemplo.invalid',     '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccc0000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'prueba47-agb@ejemplo.invalid',     '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccc0000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'prueba47-cliente@ejemplo.invalid', '', now(), now());

-- Un trigger de auth crea la fila de profiles al insertar en
-- auth.users, así que esto COMPLETA esa fila (on conflict do update),
-- no la inserta de cero.
insert into public.profiles (id, nombre, tipo, agencia, activo) values
  ('cccc0000-0000-0000-0000-0000000000a1', 'Prueba47 Agencia A', 'agencia', 'prueba47-agA', true),
  ('cccc0000-0000-0000-0000-0000000000b1', 'Prueba47 Agencia B', 'agencia', 'prueba47-agB', true),
  ('cccc0000-0000-0000-0000-0000000000c1', 'Prueba47 Cliente',   'cliente', null,           true)
on conflict (id) do update set
  nombre  = excluded.nombre,
  tipo    = excluded.tipo,
  agencia = excluded.agencia,
  activo  = excluded.activo;

insert into public.clientes (id, nombre, slug, agencia, activo) values
  ('cccc0000-0000-0000-0000-0000000000ca', 'Prueba47 Cliente A', 'prueba47-cliente-a', 'prueba47-agA', true),
  ('cccc0000-0000-0000-0000-0000000000cb', 'Prueba47 Cliente B', 'prueba47-cliente-b', 'prueba47-agB', true);

-- El usuario cliente tiene acceso SOLO al cliente A.
insert into public.acceso_cliente (cliente_id, user_id) values
  ('cccc0000-0000-0000-0000-0000000000ca', 'cccc0000-0000-0000-0000-0000000000c1');

-- Un mapeo por cliente.
insert into public.cliente_whatsapp (cliente_id, phone_number_id, waba_id, activo) values
  ('cccc0000-0000-0000-0000-0000000000ca', 'prueba47-pnid-A', 'prueba47-waba-A', true),
  ('cccc0000-0000-0000-0000-0000000000cb', 'prueba47-pnid-B', 'prueba47-waba-B', true);

-- ── Caso 1 · agencia A ve solo lo suyo ───────────────────────────
select como('cccc0000-0000-0000-0000-0000000000a1');
insert into resultado_prueba47
select 'CASO 1',
       case when count(*) = 1 and bool_and(phone_number_id = 'prueba47-pnid-A')
            then 'OK · ve solo el mapeo de su cliente (' || count(*) || ')'
            else 'FALLA · filas visibles: ' || count(*) end
  from public.cliente_whatsapp
 where phone_number_id like 'prueba47-%';
select volver();

-- ── Caso 2 · el cliente no ve NADA ───────────────────────────────
select como('cccc0000-0000-0000-0000-0000000000c1');
insert into resultado_prueba47
select 'CASO 2',
       case when count(*) = 0
            then 'OK · el cliente no ve ningún mapeo, ni el suyo'
            else 'FALLA · ve ' || count(*) end
  from public.cliente_whatsapp
 where phone_number_id like 'prueba47-%';
select volver();

-- ── Caso 3 · phone_number_id es unique global ────────────────────
-- Corre como postgres (el unique salta igual, no depende de RLS). El
-- handler evita que la violación aborte el script.
do $$
begin
  insert into public.cliente_whatsapp (cliente_id, phone_number_id, activo)
  values ('cccc0000-0000-0000-0000-0000000000cb', 'prueba47-pnid-A', true);
  insert into resultado_prueba47 values ('CASO 3', 'FALLA · el unique NO saltó');
exception when unique_violation then
  insert into resultado_prueba47 values ('CASO 3', 'OK · unique_violation al repetir phone_number_id');
end $$;

-- ── Limpieza (DELETE por prefijo, no rollback) ───────────────────
select volver();
delete from public.cliente_whatsapp where phone_number_id like 'prueba47-%';
delete from public.acceso_cliente   where user_id::text  like 'cccc0000-%';
delete from public.clientes          where id::text       like 'cccc0000-%';
delete from public.profiles          where id::text       like 'cccc0000-%';
-- auth.users al final: profiles lo referencia, así que va después.
delete from auth.users               where id::text       like 'cccc0000-%';

drop function if exists como(uuid);
drop function if exists volver();

-- ── Único select: el SQL Editor muestra esto ─────────────────────
select * from resultado_prueba47 order by caso;
