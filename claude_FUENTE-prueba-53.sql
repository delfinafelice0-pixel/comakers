-- ═══════════════════════════════════════════════════════════════
--  La prueba de la parte 53.
--
--  Prueba el RPC ventana_crm (incluida la ventana de 72 h y el control
--  de acceso) y la RLS del outbox. Como en la 46/47: impersona rol
--  authenticated con set_config, corre sobre la base real y limpia con
--  DELETE por el prefijo cccc0000.
-- ═══════════════════════════════════════════════════════════════

create temp table r (n int, que text, esperado text, dio text);

create or replace function como(quien uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', quien::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function volver() returns void
language plpgsql as $$
begin perform set_config('role', 'postgres', true); end $$;

-- ¿Qué devuelve ventana_crm para este usuario y esta conversación?
create or replace function abierta_para(quien uuid, c uuid) returns boolean
language plpgsql as $$
declare b boolean;
begin
  perform como(quien);
  select abierta into b from public.ventana_crm(c);
  perform volver();
  return b;
end $$;


-- ── Fixtures ─────────────────────────────────────────────────────
-- Dos clientes; San Eusebio con el módulo CRM prendido. Jose entra al
-- panel de San Eusebio, Ana al del otro (no ve lo de San Eusebio).
insert into public.clientes (id, nombre) values
  ('cccc0000-0000-0000-0000-00000000c001', 'San Eusebio (prueba 53)'),
  ('cccc0000-0000-0000-0000-00000000c002', 'Otro cliente (prueba 53)')
on conflict (id) do nothing;

insert into public.cliente_modulo (cliente_id, modulo, activo) values
  ('cccc0000-0000-0000-0000-00000000c001', 'crm', true),
  ('cccc0000-0000-0000-0000-00000000c002', 'crm', true)
on conflict (cliente_id, modulo) do update set activo = excluded.activo;

-- profiles.id referencia auth.users y un trigger crea la fila de
-- profiles; por eso auth.users primero y profiles con on conflict.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'cccc0000-0000-0000-0000-0000000000aa',
   'authenticated', 'authenticated', 'prueba53-jose@ejemplo.invalid', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccc0000-0000-0000-0000-0000000000bb',
   'authenticated', 'authenticated', 'prueba53-ana@ejemplo.invalid',  '', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, tipo, activo) values
  ('cccc0000-0000-0000-0000-0000000000aa', 'cliente', true),
  ('cccc0000-0000-0000-0000-0000000000bb', 'cliente', true)
on conflict (id) do update set tipo = excluded.tipo, activo = excluded.activo;

insert into public.acceso_cliente (cliente_id, user_id) values
  ('cccc0000-0000-0000-0000-00000000c001', 'cccc0000-0000-0000-0000-0000000000aa'),
  ('cccc0000-0000-0000-0000-00000000c002', 'cccc0000-0000-0000-0000-0000000000bb')
on conflict do nothing;

-- Tres conversaciones de San Eusebio:
--   e001 pauta, referral hace 1 h   → ventana ABIERTA
--   e002 pauta, referral hace 80 h  → ventana CERRADA
--   e003 directa, sin referral      → sin ventana
insert into public.conversacion (id, cliente_id, telefono, nombre, origen) values
  ('cccc0000-0000-0000-0000-00000000e001', 'cccc0000-0000-0000-0000-00000000c001', '5492494000001', 'Abierta',  'pauta'),
  ('cccc0000-0000-0000-0000-00000000e002', 'cccc0000-0000-0000-0000-00000000c001', '5492494000002', 'Cerrada',  'pauta'),
  ('cccc0000-0000-0000-0000-00000000e003', 'cccc0000-0000-0000-0000-00000000c001', '5492494000003', 'Directa',  'directo')
on conflict (id) do nothing;

insert into public.conversacion_pauta (conversacion_id, ctwa_clid, recibido_en) values
  ('cccc0000-0000-0000-0000-00000000e001', 'clid-abierta', now() - interval '1 hour'),
  ('cccc0000-0000-0000-0000-00000000e002', 'clid-cerrada', now() - interval '80 hours')
on conflict (conversacion_id) do update set recibido_en = excluded.recibido_en;


-- ═══ 1 ── La ventana, bien contada ══════════════════════════════
insert into r values (1, 'Referral hace 1 h: ventana abierta', 'true',
  abierta_para('cccc0000-0000-0000-0000-0000000000aa', 'cccc0000-0000-0000-0000-00000000e001')::text);

insert into r values (2, 'Referral hace 80 h: ventana cerrada', 'false',
  abierta_para('cccc0000-0000-0000-0000-0000000000aa', 'cccc0000-0000-0000-0000-00000000e002')::text);

insert into r values (3, 'Sin referral: sin ventana', 'false',
  abierta_para('cccc0000-0000-0000-0000-0000000000aa', 'cccc0000-0000-0000-0000-00000000e003')::text);


-- ═══ 2 ── Acceso: no se filtra por otra puerta ══════════════════
-- Ana no ve las conversaciones de San Eusebio, así que ventana_crm le
-- tiene que decir "cerrada" aunque la ventana real esté abierta.
insert into r values (4, 'Ana no accede: cerrada aunque abierta', 'false',
  abierta_para('cccc0000-0000-0000-0000-0000000000bb', 'cccc0000-0000-0000-0000-00000000e001')::text);


-- ═══ 3 ── El outbox no se lee desde el navegador ════════════════
do $$
declare n bigint;
begin
  perform como('cccc0000-0000-0000-0000-0000000000aa');
  begin
    select count(*) into n from public.outbox_envio;
  exception when insufficient_privilege or others then
    n := -1;
  end;
  perform volver();
  insert into r values (5, 'Cliente NO lee outbox_envio', '0 o error',
    case when n = 0 or n = -1 then '0 o error' else n::text end);
end $$;


-- ═══ 4 ── El outbox deduplica por idem_key ══════════════════════
-- Dos envíos con la misma idem_key = una sola fila (do nothing).
do $$
begin
  insert into public.outbox_envio (idem_key, conversacion_id, texto)
  values ('cccc0000-0000-0000-0000-0000000000f1', 'cccc0000-0000-0000-0000-00000000e001', 'hola')
  on conflict (idem_key) do nothing;
  insert into public.outbox_envio (idem_key, conversacion_id, texto)
  values ('cccc0000-0000-0000-0000-0000000000f1', 'cccc0000-0000-0000-0000-00000000e001', 'hola otra vez')
  on conflict (idem_key) do nothing;
end $$;

insert into r
select 6, 'idem_key repetida no duplica', '1', count(*)::text
  from public.outbox_envio where idem_key = 'cccc0000-0000-0000-0000-0000000000f1';


-- ═══ RESULTADO ══════════════════════════════════════════════════
select n, que, esperado, dio,
       case when dio = esperado then 'OK' else '*** FALLA ***' end as veredicto
  from r order by n;

select case when count(*) = 0 then 'TODO BIEN · 6 de 6'
            else '*** ' || count(*)::text || ' FALLAN ***' end as resumen
  from r where dio <> esperado;


-- ═══ LIMPIEZA ═══════════════════════════════════════════════════
delete from public.outbox_envio       where conversacion_id::text like 'cccc0000%';
delete from public.conversacion_pauta where conversacion_id::text like 'cccc0000%';
delete from public.conversacion        where id::text         like 'cccc0000%';
delete from public.acceso_cliente      where user_id::text    like 'cccc0000%';
delete from public.cliente_modulo      where cliente_id::text like 'cccc0000%';
delete from public.profiles            where id::text         like 'cccc0000%';
delete from auth.users                 where id::text         like 'cccc0000%';
delete from public.clientes            where id::text         like 'cccc0000%';

drop function if exists abierta_para(uuid, uuid);
drop function if exists como(uuid);
drop function if exists volver();

select 'Limpieza lista. Quedan ' ||
       (select count(*) from public.conversacion where id::text like 'cccc0000%')::text ||
       ' filas de prueba (tiene que decir 0).' as final;
