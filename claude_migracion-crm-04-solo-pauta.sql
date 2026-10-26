-- ═══════════════════════════════════════════════════════════════
--  CRM · CoMakers — Parte 04
--  Puente Zernio v1.2: cuentas que muestran SOLO las de anuncios.
--
--  Algunos clientes (AZ Translations) quieren ver en el puente solo las
--  conversaciones que vienen de un anuncio, no todos sus chats. Es por
--  cuenta: una bandera en zernio_cuenta.
--
--  Aislado: solo agrega una columna a zernio_cuenta. No toca el envío a
--  Meta, ni puente.html, ni evento_capi, ni nada del camino Meta.
--
--  SIN transacción envolvente. Correr entera. Idempotente.
-- ═══════════════════════════════════════════════════════════════


-- ── 0 ── Que esté la tabla de crm-02 ───────────────────────────
do $$
begin
  if to_regclass('public.zernio_cuenta') is null then
    raise exception 'CRM parte 04: falta zernio_cuenta (corré crm-02 primero). No corro nada.';
  end if;
end $$;


-- ── 1 ── La bandera, apagada por defecto ───────────────────────
--     false = trae todas (lo de v1.1). true = zernio-sync trae solo las
--     conversaciones con datos de referral CTWA de esa cuenta.
alter table public.zernio_cuenta
  add column if not exists solo_pauta boolean not null default false;

comment on column public.zernio_cuenta.solo_pauta is
  'true = en el puente esta cuenta muestra solo las conversaciones que vienen de un anuncio (zernio-sync filtra por CTWA al ingestar). false (default) = todas.';


-- ── 2 ── Verificación ──────────────────────────────────────────
-- Cuenta sola, no llama a helpers de rol.
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='zernio_cuenta'
       and column_name='solo_pauta')                                             as col_solo_pauta,   -- 1
  (select count(*) from public.zernio_cuenta)                                    as cuentas_total,    -- informativo
  (select count(*) from public.zernio_cuenta where solo_pauta)                   as cuentas_solo_pauta; -- 0 (todavía ninguna)
