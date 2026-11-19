-- ═══════════════════════════════════════════════════════════════
--  CRM · CoMakers — Parte 08
--  Puente Zernio: métricas del mes (como las de crm.html).
--
--  Tres cosas:
--   1. zernio_rubro.etiqueta_cerro_plural: el título de la tarjeta de
--      cierres ("Contrataciones" en servicio, "Reservas" en turismo).
--   2. zernio_conversacion.primera_consulta_at: la fecha con la que una
--      consulta cuenta en "consultas del mes". La completa zernio-sync.
--      Un trigger la deja FIJA: una vez que tiene valor, ningún update
--      (ni el upsert de la sync, ni un cliente) la cambia. Si está en
--      null, el primer valor que llegue la completa.
--   3. Backfill de las filas que ya existen, con la fecha más temprana
--      que tengamos: ctwa_captured_at (cuando Zernio guardó el clic del
--      anuncio), created_at (cuando la vimos por primera vez) o
--      ultimo_mensaje_at. Zernio no expone la fecha de creación de la
--      conversación, así que es la mejor aproximación disponible.
--
--  Aislado: solo toca tablas zernio_*. No toca evento_capi, conversacion
--  ni nada del camino Meta. No cambia estados, montos ni clasificaciones.
--
--  SIN transacción envolvente. Correr entera. Idempotente.
-- ═══════════════════════════════════════════════════════════════


-- ── 0 ── Que estén las tablas de crm-02 y crm-05 ───────────────
do $$
begin
  if to_regclass('public.zernio_conversacion') is null or to_regclass('public.zernio_rubro') is null then
    raise exception 'CRM parte 08: faltan zernio_conversacion o zernio_rubro (corré crm-02 y crm-05 primero). No corro nada.';
  end if;
end $$;


-- ── 1 ── Plural del cierre por rubro ───────────────────────────
alter table public.zernio_rubro add column if not exists etiqueta_cerro_plural text;

comment on column public.zernio_rubro.etiqueta_cerro_plural is
  'Título de la tarjeta de cierres en las métricas del puente (p. ej. Contrataciones, Reservas). NULL = "Cerradas".';

-- Solo completa las que están vacías: si alguien ya lo cambió, no se pisa.
update public.zernio_rubro set etiqueta_cerro_plural = 'Contrataciones'
 where rubro = 'servicio' and etiqueta_cerro_plural is null;
update public.zernio_rubro set etiqueta_cerro_plural = 'Reservas'
 where rubro = 'turismo' and etiqueta_cerro_plural is null;


-- ── 2 ── Fecha de la primera consulta ──────────────────────────
alter table public.zernio_conversacion add column if not exists primera_consulta_at timestamptz;

comment on column public.zernio_conversacion.primera_consulta_at is
  'Cuándo entró la consulta: define en qué mes cuenta en las métricas del puente. La completa zernio-sync (Zernio no da fecha de creación: se usa la más temprana entre el clic del anuncio y la actividad que vemos). Una vez con valor, el trigger zernio_conversacion_primera_trg no deja cambiarla.';

create index if not exists zernio_conversacion_cuenta_primera_idx
  on public.zernio_conversacion (zernio_account_id, primera_consulta_at);

-- Una vez con valor, queda fija. Si está en null, se completa.
create or replace function public.zernio_conversacion_primera_fija()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.primera_consulta_at is not null then
    new.primera_consulta_at := old.primera_consulta_at;
  end if;
  return new;
end $$;

comment on function public.zernio_conversacion_primera_fija() is
  'primera_consulta_at no se pisa: si ya tiene valor, cualquier update la deja como estaba (el upsert de zernio-sync la manda siempre).';

drop trigger if exists zernio_conversacion_primera_trg on public.zernio_conversacion;
create trigger zernio_conversacion_primera_trg
  before update on public.zernio_conversacion
  for each row execute function public.zernio_conversacion_primera_fija();


-- ── 3 ── Backfill de lo que ya existe ──────────────────────────
--     least() ignora los null: toma la más temprana de las que haya.
update public.zernio_conversacion
   set primera_consulta_at = least(ctwa_captured_at, created_at, ultimo_mensaje_at)
 where primera_consulta_at is null;


-- ── 4 ── Verificación ──────────────────────────────────────────
-- Cuenta sola, no llama a helpers de rol.
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='zernio_rubro'
       and column_name='etiqueta_cerro_plural')                                     as col_plural,              -- 1
  (select string_agg(rubro || '=' || coalesce(etiqueta_cerro_plural, '∅'), ', ' order by rubro)
     from public.zernio_rubro)                                                      as plurales,                -- servicio=Contrataciones, turismo=Reservas
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='zernio_conversacion'
       and column_name='primera_consulta_at')                                       as col_primera,             -- 1
  (select count(*) from pg_trigger
     where tgrelid='public.zernio_conversacion'::regclass
       and tgname='zernio_conversacion_primera_trg')                                as trigger_primera,         -- 1
  (select count(*) from public.zernio_conversacion)                                 as conversaciones,          -- informativo
  (select count(*) from public.zernio_conversacion where primera_consulta_at is null) as sin_primera;           -- 0
