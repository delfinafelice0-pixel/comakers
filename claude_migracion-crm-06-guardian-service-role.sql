-- ═══════════════════════════════════════════════════════════════
--  CRM · CoMakers — Parte 06
--  Puente Zernio v1.3: el guardián de columnas deja pasar a service_role.
--
--  Por qué: crm-05 dejó un guardián que solo deja pasar entero al equipo
--  (es_equipo). Al pasar zernio-sync a escribir con service_role (así un
--  cliente que sincroniza sí refresca lo existente —último mensaje, un
--  ctwa_clid tardío—), ese guardián viejo le revertiría las columnas
--  también a la ingesta (con service_role auth.uid() es null → es_equipo
--  da false). Esta migración REEMPLAZA solo la función del guardián: el
--  único restringido pasa a ser el rol authenticated que no es equipo (un
--  cliente desde el navegador). service_role y el equipo pasan enteros.
--
--  Solo CREATE OR REPLACE de la función + su comment. NO recrea el trigger
--  (sigue apuntando a la misma función por nombre). No toca nada más.
--
--  SIN transacción envolvente. Correr entera. Idempotente.
-- ═══════════════════════════════════════════════════════════════


-- ── 0 ── Que exista el guardián de crm-05 ──────────────────────
do $$
begin
  if to_regprocedure('public.zernio_conversacion_guard()') is null then
    raise exception 'CRM parte 06: falta zernio_conversacion_guard() (corré crm-05 primero). No corro nada.';
  end if;
end $$;


-- ── 1 ── Guardián nuevo: service_role y equipo pasan enteros ───
--     El único restringido es el rol authenticated que no es equipo (un
--     cliente desde el navegador): se le preservan los campos de Zernio y
--     solo puede cambiar estado, valor y moneda.
create or replace function public.zernio_conversacion_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service_role (la ingesta zernio-sync) y cualquier rol elevado pasan
  -- enteros: el único restringido es el rol authenticated que no es equipo.
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


-- ── 2 ── Verificación ──────────────────────────────────────────
select
  (select count(*) from pg_proc
     where proname='zernio_conversacion_guard')                                      as guard_existe,       -- 1
  (select count(*) from pg_trigger
     where tgrelid='public.zernio_conversacion'::regclass
       and tgname='zernio_conversacion_guard_trg')                                   as guard_trigger,      -- 1 (lo dejó crm-05)
  (position('current_user' in
     pg_get_functiondef('public.zernio_conversacion_guard()'::regprocedure)) > 0)    as pasa_service_role;  -- true
