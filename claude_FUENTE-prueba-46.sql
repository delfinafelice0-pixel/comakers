-- ═══════════════════════════════════════════════════════════════
--  La prueba de la parte 46.
--
--  Acá no alcanza con probar una función como en la 45: lo que hay
--  que probar es la RLS misma, y la RLS solo actúa cuando el rol es
--  `authenticated` y hay un JWT. Por eso cada caso hace
--  `set local role` + `request.jwt.claims`, que es exactamente lo
--  que hace PostgREST cuando entra una petición del panel.
--
--  Limpia con DELETE al final, no con rollback: así se prueba sobre
--  la base de verdad, con las policies de verdad.
--
--  Los uuid de prueba arrancan con cccc0000 para que el delete del
--  final no se lleve nada que no sea suyo.
-- ═══════════════════════════════════════════════════════════════

create temp table r (n int, que text, esperado text, dio text);


-- ── Los actores ─────────────────────────────────────────────────
-- Se reusan los de las pruebas anteriores:
--   11111111… Delfi  (agencia)
--   22222222… Marti  (agencia)
-- Y se suman dos clientes:
--   cccc0000-…-aaaa  Jose de San Eusebio (con el módulo prendido)
--   cccc0000-…-bbbb  Otro cliente cualquiera (NO debe ver nada)

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
begin
  perform set_config('role', 'postgres', true);
end $$;

-- Cuántas conversaciones ve este usuario del escenario.
create or replace function cuantas(quien uuid) returns bigint
language plpgsql as $$
declare n bigint;
begin
  perform como(quien);
  select count(*) into n from public.conversacion
   where id::text like 'cccc0000%';
  perform volver();
  return n;
end $$;


-- ── El escenario ────────────────────────────────────────────────
-- Dos clientes de la agencia, cada uno con su conversación.

insert into public.clientes (id, nombre) values
  ('cccc0000-0000-0000-0000-00000000c001', 'San Eusebio (prueba 46)'),
  ('cccc0000-0000-0000-0000-00000000c002', 'Otro cliente (prueba 46)')
on conflict (id) do nothing;

-- San Eusebio contrató el CRM. El otro no.
insert into public.cliente_modulo (cliente_id, modulo, activo) values
  ('cccc0000-0000-0000-0000-00000000c001', 'crm', true),
  ('cccc0000-0000-0000-0000-00000000c002', 'crm', false)
on conflict (cliente_id, modulo) do update set activo = excluded.activo;

-- Jose entra al panel de San Eusebio. Ana al del otro cliente.
-- profiles.id referencia auth.users, y un trigger de Supabase crea la
-- fila de profiles sola al insertar el usuario. Por eso: primero
-- auth.users, y después un UPDATE sobre la fila que el trigger creó.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'cccc0000-0000-0000-0000-0000000000aa',
   'authenticated', 'authenticated', 'prueba46-jose@ejemplo.invalid', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccc0000-0000-0000-0000-0000000000bb',
   'authenticated', 'authenticated', 'prueba46-ana@ejemplo.invalid',  '', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, tipo, activo) values
  ('cccc0000-0000-0000-0000-0000000000aa', 'cliente', true),
  ('cccc0000-0000-0000-0000-0000000000bb', 'cliente', true)
on conflict (id) do update set
  tipo   = excluded.tipo,
  activo = excluded.activo;

insert into public.acceso_cliente (cliente_id, user_id) values
  ('cccc0000-0000-0000-0000-00000000c001', 'cccc0000-0000-0000-0000-0000000000aa'),
  ('cccc0000-0000-0000-0000-00000000c002', 'cccc0000-0000-0000-0000-0000000000bb')
on conflict do nothing;

-- Dos conversaciones: una de pauta, una directa.
insert into public.conversacion
  (id, cliente_id, telefono, nombre, estado, origen, ad_id, campana, valor)
values
  ('cccc0000-0000-0000-0000-00000000e001',
   'cccc0000-0000-0000-0000-00000000c001',
   '5492494158832', 'Micaela Sosa', 'sin', 'pauta',
   '120200000000001', 'Cabañas · Finde largo', null),
  ('cccc0000-0000-0000-0000-00000000e002',
   'cccc0000-0000-0000-0000-00000000c001',
   '5492494037741', 'Rodrigo Paz', 'sin', 'directo', null, null, null),
  -- Y una del OTRO cliente, para probar el aislamiento.
  ('cccc0000-0000-0000-0000-00000000e003',
   'cccc0000-0000-0000-0000-00000000c002',
   '5492494999999', 'Alguien', 'sin', 'directo', null, null, null);

insert into public.conversacion_pauta (conversacion_id, ctwa_clid) values
  ('cccc0000-0000-0000-0000-00000000e001', 'ARBxk2Lm9QpTvN4eRj8sWc');

insert into public.mensaje (conversacion_id, wa_id, entrante, texto, enviado_en) values
  ('cccc0000-0000-0000-0000-00000000e001', 'wamid.PRUEBA46.001', true,
   'Hola! Vi el anuncio. Tienen para el finde largo?', now());


-- ═══ 1 ── Aislamiento entre clientes ════════════════════════════
-- Jose ve las dos de San Eusebio. Ana no ve ninguna de esas, y
-- tampoco la suya, porque su módulo está apagado.
insert into r values
  (1, 'Jose ve las 2 de San Eusebio', '2',
      cuantas('cccc0000-0000-0000-0000-0000000000aa')::text);

insert into r values
  (2, 'Ana NO ve nada (modulo apagado)', '0',
      cuantas('cccc0000-0000-0000-0000-0000000000bb')::text);


-- ═══ 2 ── El módulo apagado tapa de verdad ══════════════════════
-- Se le apaga a San Eusebio: Jose tiene que quedarse sin ver nada,
-- aunque siga teniendo acceso_cliente.
update public.cliente_modulo set activo = false
 where cliente_id = 'cccc0000-0000-0000-0000-00000000c001' and modulo = 'crm';

insert into r values
  (3, 'Modulo apagado: Jose deja de ver', '0',
      cuantas('cccc0000-0000-0000-0000-0000000000aa')::text);

update public.cliente_modulo set activo = true
 where cliente_id = 'cccc0000-0000-0000-0000-00000000c001' and modulo = 'crm';


-- ═══ 3 ── El ctwa_clid no se lee desde el navegador ═════════════
-- Ni siquiera con rol de agencia. RLS sin policies = nadie pasa.
do $$
declare n bigint;
begin
  perform como('11111111-1111-1111-1111-111111111111');
  begin
    select count(*) into n from public.conversacion_pauta;
  exception when insufficient_privilege or others then
    n := -1;
  end;
  perform volver();
  insert into r values (4, 'Agencia NO lee conversacion_pauta', '0 o error',
    case when n = 0 or n = -1 then '0 o error' else n::text end);
end $$;


-- ═══ 4 ── El cliente clasifica, pero no todo ════════════════════
-- Jose puede marcar "reservó".
do $$
declare v text;
begin
  perform como('cccc0000-0000-0000-0000-0000000000aa');
  begin
    update public.conversacion set estado = 'reservo', valor = 180000
     where id = 'cccc0000-0000-0000-0000-00000000e001';
    v := 'ok';
  exception when others then v := 'error: ' || sqlerrm;
  end;
  perform volver();
  insert into r values (5, 'Jose marca reservo', 'ok', v);
end $$;

-- Pero no puede mudarla a otro cliente.
do $$
declare v text;
begin
  perform como('cccc0000-0000-0000-0000-0000000000aa');
  begin
    update public.conversacion
       set cliente_id = 'cccc0000-0000-0000-0000-00000000c002'
     where id = 'cccc0000-0000-0000-0000-00000000e002';
    v := 'PASO (mal)';
  exception when others then v := 'bloqueado';
  end;
  perform volver();
  insert into r values (6, 'Jose NO puede mudar de cliente', 'bloqueado', v);
end $$;

-- Ni tocar el teléfono de la persona.
do $$
declare v text;
begin
  perform como('cccc0000-0000-0000-0000-0000000000aa');
  begin
    update public.conversacion set telefono = '5490000000000'
     where id = 'cccc0000-0000-0000-0000-00000000e002';
    v := 'PASO (mal)';
  exception when others then v := 'bloqueado';
  end;
  perform volver();
  insert into r values (7, 'Jose NO puede cambiar el telefono', 'bloqueado', v);
end $$;


-- ═══ 5 ── El trigger encoló el evento ═══════════════════════════
-- La e001 vino de pauta y tiene clid: al marcarla "reservó" en el
-- caso 5, tuvo que nacer un Purchase pendiente con el monto.
insert into r
select 8, 'Purchase encolado con monto', 'Purchase/180000.00',
       coalesce(max(e.evento || '/' || e.valor::text), 'NADA')
  from public.evento_capi e
 where e.conversacion_id = 'cccc0000-0000-0000-0000-00000000e001';

-- La e002 es directa: marcarla no tiene que encolar nada, porque
-- sin clid Meta no puede atribuirlo a ningún anuncio.
update public.conversacion set estado = 'interesado'
 where id = 'cccc0000-0000-0000-0000-00000000e002';

insert into r
select 9, 'Conversacion directa NO encola', '0',
       count(*)::text
  from public.evento_capi e
 where e.conversacion_id = 'cccc0000-0000-0000-0000-00000000e002';

-- Y "no reservó" tampoco encola: el malo es ausencia de señal.
update public.conversacion set estado = 'no'
 where id = 'cccc0000-0000-0000-0000-00000000e001';

insert into r
select 10, 'Estado "no" no agrega eventos', '1',
       count(*)::text
  from public.evento_capi e
 where e.conversacion_id = 'cccc0000-0000-0000-0000-00000000e001';


-- ═══ 6 ── Los mensajes siguen a su conversación ═════════════════
do $$
declare n bigint;
begin
  perform como('cccc0000-0000-0000-0000-0000000000bb');
  select count(*) into n from public.mensaje
   where wa_id = 'wamid.PRUEBA46.001';
  perform volver();
  insert into r values (11, 'Ana NO ve mensajes de San Eusebio', '0', n::text);
end $$;

do $$
declare n bigint;
begin
  perform como('cccc0000-0000-0000-0000-0000000000aa');
  select count(*) into n from public.mensaje
   where wa_id = 'wamid.PRUEBA46.001';
  perform volver();
  insert into r values (12, 'Jose SI ve sus mensajes', '1', n::text);
end $$;


-- ═══ 7 ── El webhook no duplica ═════════════════════════════════
-- Meta reintenta los webhooks. El mismo wa_id no puede entrar dos
-- veces o la bandeja se llena de repetidos.
do $$
declare v text;
begin
  insert into public.mensaje (conversacion_id, wa_id, entrante, texto, enviado_en)
  values ('cccc0000-0000-0000-0000-00000000e001', 'wamid.PRUEBA46.001', true,
          'Hola! Vi el anuncio. Tienen para el finde largo?', now())
  on conflict (wa_id) do nothing;
  v := 'ok';
exception when others then v := 'error: ' || sqlerrm;
end $$;

insert into r
select 13, 'wa_id repetido no duplica', '1', count(*)::text
  from public.mensaje where wa_id = 'wamid.PRUEBA46.001';


-- ═══ RESULTADO ══════════════════════════════════════════════════
select n,
       que,
       esperado,
       dio,
       case when dio = esperado then 'OK' else '*** FALLA ***' end as veredicto
  from r order by n;

select case
         when count(*) = 0 then 'TODO BIEN · 13 de 13'
         else '*** ' || count(*)::text || ' FALLAN · no sigas hasta arreglarlas ***'
       end as resumen
  from r where dio <> esperado;


-- ═══ LIMPIEZA ═══════════════════════════════════════════════════
-- Con delete, no con rollback: la prueba corrió sobre la base real.
delete from public.evento_capi        where conversacion_id::text like 'cccc0000%';
delete from public.conversacion_pauta where conversacion_id::text like 'cccc0000%';
delete from public.mensaje            where wa_id like 'wamid.PRUEBA46%';
delete from public.conversacion       where id::text like 'cccc0000%';
delete from public.acceso_cliente     where user_id::text like 'cccc0000%';
delete from public.cliente_modulo     where cliente_id::text like 'cccc0000%';
delete from public.profiles           where id::text like 'cccc0000%';
delete from auth.users                where id::text like 'cccc0000%';
delete from public.clientes           where id::text like 'cccc0000%';

drop function if exists como(uuid);
drop function if exists volver();
drop function if exists cuantas(uuid);

select 'Limpieza lista. Quedan ' ||
       (select count(*) from public.conversacion where id::text like 'cccc0000%')::text ||
       ' filas de prueba (tiene que decir 0).' as final;
