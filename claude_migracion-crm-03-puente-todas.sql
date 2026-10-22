-- ═══════════════════════════════════════════════════════════════
--  CRM · CoMakers — Parte 03
--  Puente Zernio v1.1: todas las conversaciones + etiqueta Pauta.
--
--  Agregado sobre crm-02. El equipo clasifica TODAS las consultas
--  (seguimiento), no solo las de anuncios. A Meta se informa solo las
--  que tienen ctwa_clid; el resto queda local.
--
--  Aislado: solo toca zernio_conversacion. No toca evento_capi ni nada
--  del camino Meta.
--
--  SIN transacción envolvente. Correr entera. Idempotente.
-- ═══════════════════════════════════════════════════════════════


-- ── 0 ── Que esté la tabla de crm-02 ───────────────────────────
do $$
begin
  if to_regclass('public.zernio_conversacion') is null then
    raise exception 'CRM parte 03: falta zernio_conversacion (corré crm-02 primero). No corro nada.';
  end if;
end $$;


-- ── 1 ── es_pauta: se calcula sola ─────────────────────────────
--     Pauta = vino de un anuncio (tiene referral). GENERATED STORED:
--     si el clid llega tarde en un re-sync, la fila pasa a Pauta sin
--     intervención. Puede haber Pauta SIN clid (Meta a veces lo omite):
--     esas se clasifican, pero no se informan a Meta.
alter table public.zernio_conversacion
  add column if not exists es_pauta boolean
  generated always as (ctwa_clid is not null or ctwa_source_id is not null) stored;

comment on column public.zernio_conversacion.es_pauta is
  'Calculada: true si la conversación trae datos de referral (ctwa_clid o ctwa_source_id). A Meta se informa solo si además hay ctwa_clid.';


-- ── 2 ── Monto de la venta (Pauta y No pauta) ──────────────────
alter table public.zernio_conversacion add column if not exists valor  numeric;
alter table public.zernio_conversacion add column if not exists moneda text;

comment on column public.zernio_conversacion.valor is
  'Monto de la venta, para Pauta y No pauta. Lo escribe la clasificación (local o vía zernio-conversion). zernio-sync NO lo pisa.';


-- ── 3 ── Índice por origen ─────────────────────────────────────
create index if not exists zernio_conversacion_cuenta_pauta_idx
  on public.zernio_conversacion (zernio_account_id, es_pauta);


-- ── 4 ── Verificación ──────────────────────────────────────────
-- Cuenta sola, no llama a helpers de rol.
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='zernio_conversacion'
       and column_name in ('es_pauta','valor','moneda'))                         as cols_nuevas,              -- 3
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='evento_capi')                   as cols_evento_capi_intactas; -- informativo, > 0
