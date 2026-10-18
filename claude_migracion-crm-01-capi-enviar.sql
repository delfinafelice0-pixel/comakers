-- ═══════════════════════════════════════════════════════════════
--  CRM · CoMakers — Parte 01
--  Preparar la base para que `enviar-capi` mande los eventos.
--
--  Secuencia propia del CRM (crm-01, crm-02, …), aparte de la del
--  panel interno: las dos numeran sobre la misma base desde chats que
--  no se ven, así que el CRM arranca en 01 con su prefijo para no
--  chocar (el 59 del panel queda libre).
--
--  ── Qué prepara ─────────────────────────────────────────────
--
--  La 46 dejó `evento_capi` (la cola) y el trigger que la llena al
--  clasificar una conversación de pauta. Pero nadie manda esos
--  eventos a Meta. La Edge Function `enviar-capi` lo va a hacer; esta
--  migración le deja lo que le falta a la base para manejar
--  reintentos, errores y la config por WABA. NO manda nada.
--
--  Cuatro cosas, todas ADITIVAS (columnas nuevas y un check que se
--  amplía), salvo el nombre del evento, que se corrige:
--
--  1. evento_capi.proximo_intento — cuándo vuelve a ser elegible una
--     fila. Sin esto, el cron reintentaría en cada corrida (cada
--     pocos minutos) sin respetar backoff.
--
--  2. evento_capi.codigo — clase del último resultado, para no tener
--     que parsear `detalle`. Sobre todo para distinguir el error de
--     permiso (todavía sin aprobar) de un error de verdad:
--       'VALIDACION'        dato malo del evento: terminal, no reintenta
--       'VENCIDO'           > 7 días: Meta ya no lo acepta, terminal
--       'TRANSITORIO'       429/5xx/red: reintenta con backoff
--       'PERMISO_PENDIENTE' whatsapp_business_manage_events sin aprobar
--       'SIN_DATASET'       falta el dataset_id del WABA (alta pendiente)
--       'SIN_WABA'          falta el waba_id en cliente_whatsapp
--     Las tres últimas NO son terminales: la fila queda 'pendiente'
--     esperando un alta de configuración (o la aprobación del permiso).
--
--  3. cliente_whatsapp.dataset_id y .moneda — columna propia, no desde
--     cliente_integracion (meta_ads): un cliente con CRM y sin pauta
--     conectada no tendría de dónde sacar la moneda, y el monto lo
--     carga el negocio en la moneda en la que cobra, que no tiene por
--     qué ser la de la cuenta publicitaria. De las 15 cuentas la
--     mayoría es ARS (de ahí el default), pero hay una USD y una EUR:
--     por eso es por cliente y editable.
--
--  4. El evento de "interesado" es `LeadSubmitted`, no `Lead`. Para
--     action_source = business_messaging, el ejemplo de Meta usa
--     LeadSubmitted (case-sensitive); `Lead` es el standard del pixel.
--     Se amplía el check y se actualiza el trigger encolar_evento_capi.
--     evento_capi todavía no tiene tráfico real, así que es seguro.
--
--  SIN transacción envolvente. Correr entera. Idempotente.
-- ═══════════════════════════════════════════════════════════════


-- ── 0 ── Que esté lo que esto toca ─────────────────────────────
do $$
declare v_falta text := '';
begin
  if to_regclass('public.evento_capi')      is null then v_falta := v_falta || ' evento_capi';      end if;
  if to_regclass('public.cliente_whatsapp') is null then v_falta := v_falta || ' cliente_whatsapp'; end if;
  if to_regclass('public.conversacion')     is null then v_falta := v_falta || ' conversacion';     end if;
  if to_regprocedure('public.encolar_evento_capi()') is null then
    v_falta := v_falta || ' encolar_evento_capi()'; end if;
  if v_falta <> '' then
    raise exception 'CRM parte 01: falta%. No corro nada.', v_falta;
  end if;
end $$;


-- ── 1 ── Columnas de reintento/error en la cola ────────────────
alter table public.evento_capi
  add column if not exists proximo_intento timestamptz not null default now();

alter table public.evento_capi
  add column if not exists codigo text;

comment on column public.evento_capi.proximo_intento is
  'Cuándo vuelve a ser elegible esta fila. enviar-capi agarra las pendientes con proximo_intento <= now(). El backoff de los transitorios lo empuja al futuro.';
comment on column public.evento_capi.codigo is
  'Clase del último resultado: VALIDACION | VENCIDO | TRANSITORIO | PERMISO_PENDIENTE | SIN_DATASET | SIN_WABA. Las tres últimas NO son terminales (la fila sigue pendiente esperando config/permiso).';

-- La cola que agarra la función: pendientes ya elegibles, más viejas
-- primero. El índice de la 46 era (estado, creado_en) where estado<>'ok';
-- este es el que sirve al claim real.
create index if not exists evento_capi_cola_idx
  on public.evento_capi (proximo_intento) where estado = 'pendiente';


-- ── 2 ── dataset_id y moneda por WABA/cliente ──────────────────
alter table public.cliente_whatsapp
  add column if not exists dataset_id text;

alter table public.cliente_whatsapp
  add column if not exists moneda text not null default 'ARS';

comment on column public.cliente_whatsapp.dataset_id is
  'Dataset de Conversions API del WABA. Uno por WABA. Lo resuelve enviar-capi la primera vez (POST /{waba_id}/dataset, idempotente) y lo cachea acá. Mientras esté null, los eventos quedan pendientes con codigo=SIN_DATASET.';
comment on column public.cliente_whatsapp.moneda is
  'ISO 4217 para custom_data.currency del Purchase. La moneda en la que el negocio cobra, no la de la cuenta publicitaria. Default ARS; editable por cliente (hay cuentas USD y EUR).';


-- ── 3 ── Lead → LeadSubmitted ──────────────────────────────────
-- ORDEN: soltar el check viejo PRIMERO (si no, el update a
-- 'LeadSubmitted' violaría el check que solo admite 'Lead'/'Purchase'),
-- después migrar las filas que pudieran existir de pruebas, después
-- poner el check nuevo. Si evento_capi está vacío (lo esperado), el
-- update no toca nada.
alter table public.evento_capi drop constraint if exists evento_capi_evento_check;

update public.evento_capi set evento = 'LeadSubmitted' where evento = 'Lead';

alter table public.evento_capi
  add constraint evento_capi_evento_check check (evento in ('LeadSubmitted', 'Purchase'));

-- El trigger: idéntico a la 46 salvo el nombre del evento de interesado.
create or replace function public.encolar_evento_capi()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evento text;
begin
  if new.estado is not distinct from old.estado then
    return new;
  end if;

  v_evento := case new.estado
                when 'reservo'    then 'Purchase'
                when 'interesado' then 'LeadSubmitted'   -- (antes era el standard del pixel)
                else null
              end;

  if v_evento is null then
    return new;
  end if;

  -- Sin anuncio de origen no hay nada que informarle a Meta.
  if new.origen <> 'pauta'
     or not exists (select 1 from public.conversacion_pauta cp
                     where cp.conversacion_id = new.id) then
    return new;
  end if;

  -- Si ya hay uno pendiente del mismo tipo, no duplicamos: alcanza
  -- con que la Edge Function mande el último estado.
  if exists (select 1 from public.evento_capi e
              where e.conversacion_id = new.id
                and e.evento = v_evento
                and e.estado = 'pendiente') then
    return new;
  end if;

  insert into public.evento_capi (conversacion_id, evento, valor)
  values (new.id, v_evento,
          case when v_evento = 'Purchase' then new.valor else null end);

  return new;
end $$;

-- El trigger en sí no cambia de definición, pero lo re-aseguramos por
-- si esta migración corre en una base donde no estaba.
drop trigger if exists conversacion_encola_capi on public.conversacion;
create trigger conversacion_encola_capi
  after update of estado on public.conversacion
  for each row execute function public.encolar_evento_capi();


-- ── 4 ── Corregir el comentario viejo de la 46 ─────────────────
-- Decía "la vacía la Edge Function capi-evento". El nombre real es
-- enviar-capi (consistente con wa-enviar y pull-ads).
comment on table public.evento_capi is
  'Cola de eventos para Conversions API. La llena el trigger conversacion_encola_capi, la vacía la Edge Function enviar-capi.';


-- ── 5 ── Verificación ──────────────────────────────────────────
-- Cuenta sola, no llama a helpers de rol (en el SQL Editor auth.uid()
-- es null y cortaría el script).
select
  -- columnas nuevas presentes
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='evento_capi'
       and column_name in ('proximo_intento','codigo'))                         as cols_evento_capi,   -- 2
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='cliente_whatsapp'
       and column_name in ('dataset_id','moneda'))                              as cols_cliente_wa,    -- 2
  -- el check ya admite LeadSubmitted y NO admite Lead
  (select pg_get_constraintdef(oid) from pg_constraint
     where conrelid='public.evento_capi'::regclass
       and conname='evento_capi_evento_check')                                  as check_evento,       -- ...LeadSubmitted...
  -- el trigger encola LeadSubmitted, no Lead
  (pg_get_functiondef('public.encolar_evento_capi()'::regprocedure)
     ilike '%LeadSubmitted%')                                                   as trigger_leadsubmitted, -- true
  (pg_get_functiondef('public.encolar_evento_capi()'::regprocedure)
     ilike '%''Lead''%')                                                        as trigger_todavia_lead;  -- false
