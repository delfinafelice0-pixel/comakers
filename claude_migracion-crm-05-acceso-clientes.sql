-- ═══════════════════════════════════════════════════════════════
--  CRM · CoMakers — Parte 05
--  Puente Zernio v1.3: acceso de clientes + estados por rubro.
--
--  Dos cosas:
--   A) El cliente entra a puente.html con su MISMO login del panel y ve
--      SOLO sus cuentas y conversaciones. Se vincula zernio_cuenta a un
--      cliente del panel (clientes), y la RLS abre la rama de cliente
--      además de la de equipo. El cliente clasifica; no toca los datos
--      que trae Zernio (lo garantiza un trigger, ver nota en la parte 6).
--   B) Estados fijos con nombres por rubro (turismo/servicio), en tabla
--      de datos: sumar rubro = insertar fila, sin tocar código.
--
--  Aislado: solo toca tablas zernio_*. No toca evento_capi, conversacion,
--  cliente_whatsapp ni nada del camino Meta ni de crm.html. El contrato
--  con Zernio y los event_id NO cambian (eso vive en zernio-conversion).
--
--  SIN transacción envolvente. Correr entera. Idempotente.
-- ═══════════════════════════════════════════════════════════════


-- ── 0 ── Precondiciones ────────────────────────────────────────
do $$
declare v_falta text := '';
begin
  if to_regclass('public.zernio_cuenta')       is null then v_falta := v_falta || ' zernio_cuenta';       end if;
  if to_regclass('public.zernio_conversacion') is null then v_falta := v_falta || ' zernio_conversacion'; end if;
  if to_regclass('public.zernio_conversion')   is null then v_falta := v_falta || ' zernio_conversion';   end if;
  if to_regclass('public.clientes')            is null then v_falta := v_falta || ' clientes';            end if;
  if to_regclass('public.acceso_cliente')      is null then v_falta := v_falta || ' acceso_cliente';      end if;
  if to_regprocedure('public.es_equipo()')                 is null then v_falta := v_falta || ' es_equipo()';                 end if;
  if to_regprocedure('public.cliente_de_mi_agencia(uuid)') is null then v_falta := v_falta || ' cliente_de_mi_agencia(uuid)'; end if;
  if v_falta <> '' then
    raise exception 'CRM parte 05: faltan dependencias:%. No corro nada.', v_falta;
  end if;
end $$;


-- ── 1 ── Rubros: estados fijos, nombres por rubro ──────────────
--     Las CLAVES de estado son fijas (código). Lo que cambia por rubro
--     es cómo se LLAMA cada una en pantalla. Config como datos: sumar
--     un rubro = insertar una fila acá, sin tocar el puente.
create table if not exists public.zernio_rubro (
  rubro                   text primary key,
  etiqueta_interesado     text not null,
  etiqueta_cerro          text not null,
  etiqueta_no_cerro       text not null,
  etiqueta_sin_responder  text not null
);

comment on table public.zernio_rubro is
  'Nombres de pantalla de los estados fijos (interesado/cerro/no_cerro/sin_responder) por rubro. Sumar rubro = insertar fila; el puente no se toca. La clave nuevo no se nombra acá (es "sin clasificar" en todos).';

insert into public.zernio_rubro
  (rubro, etiqueta_interesado, etiqueta_cerro, etiqueta_no_cerro, etiqueta_sin_responder) values
  ('turismo',  'Está interesado', 'Reservó',  'No reservó',  'Sin responder'),
  ('servicio', 'Pidió presupuesto', 'Contrató', 'No contrató', 'Sin responder')
on conflict (rubro) do update set
  etiqueta_interesado    = excluded.etiqueta_interesado,
  etiqueta_cerro         = excluded.etiqueta_cerro,
  etiqueta_no_cerro      = excluded.etiqueta_no_cerro,
  etiqueta_sin_responder = excluded.etiqueta_sin_responder;


-- ── 2 ── zernio_cuenta: vínculo con el cliente + rubro ─────────
--     cliente_id NULLABLE: las cuentas de prueba (el Piloto) pueden no
--     tener cliente y siguen siendo del equipo. rubro NOT NULL default
--     'servicio' (el rubro de la primera clienta), con FK a zernio_rubro.
alter table public.zernio_cuenta
  add column if not exists cliente_id uuid references public.clientes(id);

comment on column public.zernio_cuenta.cliente_id is
  'Cliente del panel (clientes.id) dueño de esta cuenta. NULL = cuenta de prueba, solo del equipo. Lo usa la RLS para abrir la rama de cliente.';

alter table public.zernio_cuenta
  add column if not exists rubro text not null default 'servicio'
    references public.zernio_rubro(rubro);

comment on column public.zernio_cuenta.rubro is
  'Rubro de la cuenta (zernio_rubro.rubro). Decide cómo se nombran los estados en el puente. Default servicio.';

create index if not exists zernio_cuenta_cliente_idx
  on public.zernio_cuenta (cliente_id);


-- ── 3 ── Estado por rubro en zernio_conversacion ───────────────
--     Claves nuevas: nuevo | interesado | cerro | no_cerro | sin_responder.
--     Se convierte lo viejo (v1/v1.1/v1.2): lead→interesado, venta→cerro,
--     descartado→no_cerro. El default sigue siendo 'nuevo'.
alter table public.zernio_conversacion
  drop constraint if exists zernio_conversacion_estado_check;

update public.zernio_conversacion set estado = case estado
  when 'lead'       then 'interesado'
  when 'venta'      then 'cerro'
  when 'descartado' then 'no_cerro'
  else estado
end
where estado in ('lead', 'venta', 'descartado');

alter table public.zernio_conversacion
  add constraint zernio_conversacion_estado_check
  check (estado in ('nuevo', 'interesado', 'cerro', 'no_cerro', 'sin_responder'));


-- ── 4 ── Helpers de visibilidad ────────────────────────────────
--     Espejan el patrón del CRM (parte 46): el equipo ve lo de su agencia;
--     el cliente ve lo suyo vía acceso_cliente. Las conversaciones y el
--     log cuelgan de zernio_account_id, así que resuelven el cliente a
--     través de la cuenta. security definer para que un cliente pueda
--     resolver sin leer profiles/acceso_cliente de otros.

-- ¿El usuario (cliente) tiene acceso a este cliente del panel?
create or replace function public.zernio_cliente_ve(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.acceso_cliente a
     where a.cliente_id = c and a.user_id = auth.uid()
  );
$$;

comment on function public.zernio_cliente_ve(uuid) is
  'true si el usuario actual tiene acceso (acceso_cliente) a ese cliente. Rama de cliente de la RLS del puente. Sin gate de módulo: el puente no se cobra aparte.';

-- Equipo: ve la cuenta si es de su agencia, o si no tiene cliente (prueba).
create or replace function public.zernio_equipo_ve_cuenta(acct text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_equipo() and exists (
    select 1 from public.zernio_cuenta zc
     where zc.zernio_account_id = acct
       and (zc.cliente_id is null or public.cliente_de_mi_agencia(zc.cliente_id))
  );
$$;

-- Cliente: ve la cuenta si está vinculada a un cliente al que accede.
create or replace function public.zernio_cliente_ve_cuenta(acct text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.zernio_cuenta zc
     where zc.zernio_account_id = acct
       and zc.cliente_id is not null
       and public.zernio_cliente_ve(zc.cliente_id)
  );
$$;


-- ── 5 ── RLS ───────────────────────────────────────────────────
--     Equipo (con su ajuste para cuentas sin cliente) O cliente dueño.

-- zernio_cuenta: equipo todo; cliente solo lee las suyas.
drop policy if exists zernio_cuenta_equipo        on public.zernio_cuenta;
drop policy if exists zernio_cuenta_equipo_all    on public.zernio_cuenta;
drop policy if exists zernio_cuenta_cliente_lee   on public.zernio_cuenta;
create policy zernio_cuenta_equipo_all on public.zernio_cuenta
  for all to authenticated
  using      (public.es_equipo() and (cliente_id is null or public.cliente_de_mi_agencia(cliente_id)))
  with check (public.es_equipo() and (cliente_id is null or public.cliente_de_mi_agencia(cliente_id)));
create policy zernio_cuenta_cliente_lee on public.zernio_cuenta
  for select to authenticated
  using (cliente_id is not null and public.zernio_cliente_ve(cliente_id));

-- zernio_conversacion: equipo lee/escribe lo de su agencia; cliente lee
-- lo suyo y lo clasifica (las columnas que puede tocar las limita el
-- trigger de la parte 6, no la RLS —la RLS decide filas, no columnas).
drop policy if exists zernio_conversacion_equipo            on public.zernio_conversacion;
drop policy if exists zernio_conversacion_equipo_all        on public.zernio_conversacion;
drop policy if exists zernio_conversacion_cliente_lee       on public.zernio_conversacion;
drop policy if exists zernio_conversacion_cliente_clasifica on public.zernio_conversacion;
create policy zernio_conversacion_equipo_all on public.zernio_conversacion
  for all to authenticated
  using      (public.zernio_equipo_ve_cuenta(zernio_account_id))
  with check (public.zernio_equipo_ve_cuenta(zernio_account_id));
create policy zernio_conversacion_cliente_lee on public.zernio_conversacion
  for select to authenticated
  using (public.zernio_cliente_ve_cuenta(zernio_account_id));
-- El cliente clasifica lo suyo (y la sync de su cuenta inserta). update +
-- insert; delete queda solo para el equipo.
create policy zernio_conversacion_cliente_clasifica on public.zernio_conversacion
  for update to authenticated
  using      (public.zernio_cliente_ve_cuenta(zernio_account_id))
  with check (public.zernio_cliente_ve_cuenta(zernio_account_id));
drop policy if exists zernio_conversacion_cliente_inserta on public.zernio_conversacion;
create policy zernio_conversacion_cliente_inserta on public.zernio_conversacion
  for insert to authenticated
  with check (public.zernio_cliente_ve_cuenta(zernio_account_id));

-- zernio_conversion (log): lectura con la misma condición; lo escribe la
-- function (con el token del usuario), equipo o cliente dueño de la cuenta.
drop policy if exists zernio_conversion_equipo         on public.zernio_conversion;
drop policy if exists zernio_conversion_ve             on public.zernio_conversion;
drop policy if exists zernio_conversion_escribe        on public.zernio_conversion;
create policy zernio_conversion_ve on public.zernio_conversion
  for select to authenticated
  using (public.zernio_equipo_ve_cuenta(zernio_account_id)
         or public.zernio_cliente_ve_cuenta(zernio_account_id));
create policy zernio_conversion_escribe on public.zernio_conversion
  for insert to authenticated
  with check (public.zernio_equipo_ve_cuenta(zernio_account_id)
              or public.zernio_cliente_ve_cuenta(zernio_account_id));
-- update del log (upsert onConflict=event_id) con la misma condición.
drop policy if exists zernio_conversion_actualiza on public.zernio_conversion;
create policy zernio_conversion_actualiza on public.zernio_conversion
  for update to authenticated
  using      (public.zernio_equipo_ve_cuenta(zernio_account_id)
              or public.zernio_cliente_ve_cuenta(zernio_account_id))
  with check (public.zernio_equipo_ve_cuenta(zernio_account_id)
              or public.zernio_cliente_ve_cuenta(zernio_account_id));

-- zernio_rubro: lo lee cualquier autenticado (son etiquetas, no datos
-- sensibles); lo escribe solo el equipo.
alter table public.zernio_rubro enable row level security;
drop policy if exists zernio_rubro_lee     on public.zernio_rubro;
drop policy if exists zernio_rubro_escribe on public.zernio_rubro;
create policy zernio_rubro_lee on public.zernio_rubro
  for select to authenticated using (true);
create policy zernio_rubro_escribe on public.zernio_rubro
  for all to authenticated
  using (public.es_equipo()) with check (public.es_equipo());


-- ── 6 ── Guard de columnas del cliente ─────────────────────────
--     Lo que el spec pide como "permisos por columna como la 46": el
--     cliente solo puede tocar estado, valor y moneda; nada de lo que
--     trae Zernio.
--
--     Qué restringe: SOLO lo que escribe el NAVEGADOR de un cliente. La
--     ingesta (zernio-sync) escribe todas las columnas de Zernio con
--     service_role (ver nota en la function), que acá pasa entero —igual
--     que el webhook de la 46—. El rol authenticated que NO es equipo (un
--     cliente desde el navegador) es el único que queda limitado a
--     estado/valor/moneda; si a ese rol le diéramos grants amplios podría
--     pisar el teléfono, el clid o el monto. Grants por columna no servían
--     porque antes la sync también corría como authenticated; ahora que la
--     sync va por service_role, el trigger alcanza y es más simple de leer.
create or replace function public.zernio_conversacion_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service_role (la ingesta) y cualquier rol elevado pasan enteros: el
  -- único restringido es el rol authenticated que no es equipo.
  if current_user <> 'authenticated' then return new; end if;
  if public.es_equipo() then return new; end if;   -- el equipo escribe todo
  -- Cliente desde el navegador: se preservan los datos de Zernio. Solo
  -- quedan editables estado, valor, moneda (y updated_at, inocuo).
  new.zernio_account_id := old.zernio_account_id;
  new.conversation_id   := old.conversation_id;
  new.phone_e164        := old.phone_e164;
  new.nombre            := old.nombre;
  new.ctwa_clid         := old.ctwa_clid;
  new.ctwa_source_id    := old.ctwa_source_id;
  new.ctwa_source_url   := old.ctwa_source_url;
  new.ctwa_headline     := old.ctwa_headline;
  new.ctwa_source_type  := old.ctwa_source_type;
  new.ctwa_captured_at  := old.ctwa_captured_at;
  new.primer_mensaje    := old.primer_mensaje;
  new.ultimo_mensaje_at := old.ultimo_mensaje_at;
  new.created_at        := old.created_at;
  -- id (PK) y es_pauta (generada) no se asignan.
  return new;
end $$;

comment on function public.zernio_conversacion_guard() is
  'Permisos por columna del cliente, por trigger. Solo limita al rol authenticated que no es equipo (navegador de un cliente): preserva los campos de Zernio y deja cambiar estado/valor/moneda. service_role (la ingesta zernio-sync) y el equipo pasan enteros.';

drop trigger if exists zernio_conversacion_guard_trg on public.zernio_conversacion;
create trigger zernio_conversacion_guard_trg
  before update on public.zernio_conversacion
  for each row execute function public.zernio_conversacion_guard();


-- ── 7 ── Grants ────────────────────────────────────────────────
--     Amplios para que las sentencias corran (la RLS decide filas y el
--     trigger decide columnas del cliente). Nada para anon.
revoke all on public.zernio_rubro from anon;
grant select on public.zernio_rubro to authenticated;
grant insert, update, delete on public.zernio_rubro to authenticated;
-- zernio_cuenta / zernio_conversacion / zernio_conversion ya tienen los
-- grants de la crm-02; se reafirman por si acaso.
grant select, insert, update, delete on public.zernio_cuenta       to authenticated;
grant select, insert, update, delete on public.zernio_conversacion to authenticated;
grant select, insert, update, delete on public.zernio_conversion   to authenticated;


-- ── 8 ── Verificación ──────────────────────────────────────────
-- Cuenta sola, no llama a helpers de rol.
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='zernio_cuenta'
       and column_name='cliente_id')                                              as col_cliente_id,        -- 1
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='zernio_cuenta'
       and column_name='rubro')                                                   as col_rubro,             -- 1
  (select count(*) from public.zernio_rubro)                                      as rubros,                -- 2 (turismo, servicio)
  (select count(*) from public.zernio_conversacion
     where estado in ('lead','venta','descartado'))                               as estados_viejos,        -- 0
  (select count(*) from public.zernio_conversacion
     where estado not in ('nuevo','interesado','cerro','no_cerro','sin_responder')) as estados_fuera_check, -- 0
  (select count(*) from pg_policies
     where schemaname='public' and tablename like 'zernio_%')                     as policies,              -- 11
  (select count(*) from pg_trigger
     where tgrelid='public.zernio_conversacion'::regclass
       and tgname='zernio_conversacion_guard_trg')                               as guard_trigger,         -- 1
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='evento_capi')                    as cols_evento_capi;      -- informativo, intacto
