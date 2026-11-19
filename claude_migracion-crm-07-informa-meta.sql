-- ═══════════════════════════════════════════════════════════════
--  CRM · CoMakers — Parte 07
--  Puente Zernio: cuentas que NO informan a Meta.
--
--  Por qué: Meta no permite la Conversions API para mensajería en la
--  UE (GDPR). Una cuenta de España clasifica igual sus consultas, pero
--  zernio-conversion no le manda nada a Zernio/Meta.
--
--  Qué hace: agrega zernio_cuenta.informa_meta (default true). Las
--  cuentas que ya existen quedan en true: siguen igual que hoy. Para
--  apagarlo en una cuenta, un update aparte (no va en esta migración).
--
--  Aislado: solo agrega una columna a zernio_cuenta. No toca evento_capi
--  ni nada del camino Meta.
--
--  SIN transacción envolvente. Correr entera. Idempotente.
-- ═══════════════════════════════════════════════════════════════


-- ── 0 ── Que esté la tabla de crm-02 ───────────────────────────
do $$
begin
  if to_regclass('public.zernio_cuenta') is null then
    raise exception 'CRM parte 07: falta zernio_cuenta (corré crm-02 primero). No corro nada.';
  end if;
end $$;


-- ── 1 ── La bandera, prendida por defecto ──────────────────────
alter table public.zernio_cuenta
  add column if not exists informa_meta boolean not null default true;

comment on column public.zernio_cuenta.informa_meta is
  'true (default) = lead/venta con clid se informan a Meta vía Zernio. false = la cuenta clasifica igual, pero zernio-conversion no llama a Zernio (p. ej. cuentas de la UE: Meta no permite la Conversions API para mensajería).';


-- ── 2 ── Verificación ──────────────────────────────────────────
-- Cuenta sola, no llama a helpers de rol.
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='zernio_cuenta'
       and column_name='informa_meta')                                           as col_informa_meta,      -- 1
  (select count(*) from public.zernio_cuenta)                                    as cuentas_total,         -- informativo
  (select count(*) from public.zernio_cuenta where not informa_meta)             as cuentas_sin_meta;      -- 0 (todavía ninguna)
