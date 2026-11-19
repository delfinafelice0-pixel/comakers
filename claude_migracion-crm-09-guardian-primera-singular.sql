-- ═══════════════════════════════════════════════════════════════
--  CRM · CoMakers — Parte 09
--  Puente Zernio: dos ajustes a las métricas de crm-08.
--
--   1. El guardián de columnas suma primera_consulta_at: un cliente desde
--      el navegador no la puede escribir NUNCA, ni cuando está vacía.
--      · En UPDATE se le preserva la de antes (como el resto de los campos
--        de Zernio).
--      · En INSERT (la política zernio_conversacion_cliente_inserta de
--        crm-05 le deja insertar en sus cuentas) se le fuerza a null; la
--        completa después zernio-sync con service_role.
--      Para cubrir el INSERT, el trigger del guardián pasa de "before
--      update" a "before insert or update". En INSERT el guardián SOLO
--      toca primera_consulta_at: el resto de lo que inserta queda igual
--      que hoy. service_role y el equipo pasan enteros, como en crm-06.
--   2. zernio_rubro.etiqueta_cerro_singular, para decir "1 contratación"
--      / "1 reserva" en las tarjetas.
--
--  Aislado: solo toca tablas y funciones zernio_*. No toca evento_capi ni
--  nada del camino Meta. No cambia estados, montos ni fechas existentes.
--
--  SIN transacción envolvente. Correr entera. Idempotente.
-- ═══════════════════════════════════════════════════════════════


-- ── 0 ── Que estén crm-06 y crm-08 ─────────────────────────────
do $$
begin
  if to_regprocedure('public.zernio_conversacion_guard()') is null then
    raise exception 'CRM parte 09: falta zernio_conversacion_guard() (corré crm-05 y crm-06 primero). No corro nada.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='zernio_conversacion'
                    and column_name='primera_consulta_at') then
    raise exception 'CRM parte 09: falta zernio_conversacion.primera_consulta_at (corré crm-08 primero). No corro nada.';
  end if;
end $$;


-- ── 1 ── Guardián: suma primera_consulta_at ────────────────────
create or replace function public.zernio_conversacion_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service_role (la ingesta zernio-sync) y cualquier rol elevado pasan
  -- enteros: el único restringido es el rol authenticated que no es equipo.
  if current_user <> 'authenticated' then return new; end if;
  if public.es_equipo() then return new; end if;   -- el equipo escribe todo

  -- Cliente que inserta: no puede fijar la fecha de la primera consulta.
  -- La completa zernio-sync. El resto del insert queda como antes.
  if tg_op = 'INSERT' then
    new.primera_consulta_at := null;
    return new;
  end if;

  -- Cliente que actualiza: se preservan los datos de Zernio. Solo quedan
  -- editables estado, valor, moneda (y updated_at, inocuo).
  new.zernio_account_id   := old.zernio_account_id;
  new.conversation_id     := old.conversation_id;
  new.phone_e164          := old.phone_e164;
  new.nombre              := old.nombre;
  new.ctwa_clid           := old.ctwa_clid;
  new.ctwa_source_id      := old.ctwa_source_id;
  new.ctwa_source_url     := old.ctwa_source_url;
  new.ctwa_headline       := old.ctwa_headline;
  new.ctwa_source_type    := old.ctwa_source_type;
  new.ctwa_captured_at    := old.ctwa_captured_at;
  new.primer_mensaje      := old.primer_mensaje;
  new.ultimo_mensaje_at   := old.ultimo_mensaje_at;
  new.created_at          := old.created_at;
  new.primera_consulta_at := old.primera_consulta_at;   -- crm-09: ni cuando está vacía
  -- id (PK) y es_pauta (generada) no se asignan.
  return new;
end $$;

comment on function public.zernio_conversacion_guard() is
  'Permisos por columna del cliente, por trigger. Solo limita al rol authenticated que no es equipo (navegador de un cliente): en UPDATE preserva los campos de Zernio y primera_consulta_at, y deja cambiar estado/valor/moneda; en INSERT le fuerza primera_consulta_at a null. service_role (la ingesta zernio-sync) y el equipo pasan enteros.';

-- El trigger pasa a cubrir también INSERT (antes era solo UPDATE).
drop trigger if exists zernio_conversacion_guard_trg on public.zernio_conversacion;
create trigger zernio_conversacion_guard_trg
  before insert or update on public.zernio_conversacion
  for each row execute function public.zernio_conversacion_guard();


-- ── 2 ── Singular del cierre por rubro ─────────────────────────
alter table public.zernio_rubro add column if not exists etiqueta_cerro_singular text;

comment on column public.zernio_rubro.etiqueta_cerro_singular is
  'Título de la tarjeta de cierres cuando hay uno solo (p. ej. Contratación, Reserva). NULL = "Cerrada".';

-- Solo completa las que están vacías: si alguien ya lo cambió, no se pisa.
update public.zernio_rubro set etiqueta_cerro_singular = 'Contratación'
 where rubro = 'servicio' and etiqueta_cerro_singular is null;
update public.zernio_rubro set etiqueta_cerro_singular = 'Reserva'
 where rubro = 'turismo' and etiqueta_cerro_singular is null;


-- ── 3 ── Verificación ──────────────────────────────────────────
select
  (position('primera_consulta_at := old.primera_consulta_at' in
     pg_get_functiondef('public.zernio_conversacion_guard()'::regprocedure)) > 0)    as guard_preserva_primera,  -- true
  (position('current_user' in
     pg_get_functiondef('public.zernio_conversacion_guard()'::regprocedure)) > 0)    as pasa_service_role,       -- true
  (select count(*) from pg_trigger
     where tgrelid='public.zernio_conversacion'::regclass
       and tgname='zernio_conversacion_guard_trg'
       and (tgtype & 4) <> 0 and (tgtype & 16) <> 0)                                 as guard_insert_y_update,   -- 1
  (select count(*) from pg_trigger
     where tgrelid='public.zernio_conversacion'::regclass
       and tgname='zernio_conversacion_primera_trg')                                 as trigger_primera,         -- 1 (lo dejó crm-08)
  (select string_agg(rubro || '=' || coalesce(etiqueta_cerro_singular, '∅'), ', ' order by rubro)
     from public.zernio_rubro)                                                       as singulares;              -- servicio=Contratación, turismo=Reserva
