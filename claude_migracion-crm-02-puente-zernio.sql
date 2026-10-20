-- ═══════════════════════════════════════════════════════════════
--  CRM · CoMakers — Parte 02
--  Puente Zernio: conversaciones CTWA de WhatsApp vía Zernio.
--
--  ── Qué es ──────────────────────────────────────────────────
--  Anuncios Meta → WhatsApp (vía Zernio) traen consultas con
--  ctwa_clid. Guardamos el contacto + el clid, el equipo clasifica a
--  mano (lead/venta) y se manda el evento a Meta por Zernio. Lo usa el
--  EQUIPO, no el cliente final.
--
--  ── Aislado (no negociable) ─────────────────────────────────
--  Todo con prefijo zernio_. CERO dependencia del camino Meta: no toca
--  evento_capi, conversacion, conversacion_pauta, cliente_whatsapp ni
--  sus crons. Baja de Zernio = borrar tablas zernio_*, functions
--  zernio-* y puente.html, sin desenredar nada.
--
--  ── Envío sin cola ──────────────────────────────────────────
--  El evento a Meta se manda SINCRÓNICO al clasificar (Edge Function
--  zernio-conversion). No se encola en evento_capi, así que el cron de
--  Meta no ve ninguna fila de acá. Por eso no hay pg_cron en esta
--  migración.
--
--  SIN transacción envolvente. Correr entera. Idempotente.
-- ═══════════════════════════════════════════════════════════════


-- ── 0 ── Que esté el helper de rol ─────────────────────────────
--     "Solo el equipo" = es_equipo(), igual que el branch de agencia
--     del camino Meta (parte 46), pero SIN cliente_de_mi_agencia: estas
--     tablas no cuelgan de un cliente_id, son herramienta interna del
--     equipo. No hay rama de cliente final a propósito.
do $$
begin
  if to_regprocedure('public.es_equipo()') is null then
    raise exception 'CRM parte 02: falta es_equipo(). No corro nada.';
  end if;
end $$;


-- ── 1 ── Cuentas/WABA conectadas (config como datos) ───────────
--     Multi-cuenta desde el arranque: sumar un cliente = agregar una
--     fila, sin tocar código. La ZERNIO_API_KEY NO vive acá (es secret
--     de Supabase); esta tabla solo lista los accountId de Zernio.
create table if not exists public.zernio_cuenta (
  zernio_account_id text primary key,
  label             text not null,
  activa            boolean not null default true,
  created_at        timestamptz not null default now()
);

comment on table public.zernio_cuenta is
  'Cuentas/WABA de Zernio conectadas. Config como datos: sumar cliente = agregar fila. La API key es secret de Supabase, NUNCA acá.';


-- ── 2 ── Conversaciones CTWA entrantes ─────────────────────────
create table if not exists public.zernio_conversacion (
  id                uuid primary key default gen_random_uuid(),
  zernio_account_id text not null references public.zernio_cuenta(zernio_account_id),

  conversation_id   text not null,      -- id de la conversación en Zernio
  phone_e164        text,               -- dígitos, sin +
  nombre            text,

  ctwa_clid         text,               -- click id; NULL si Meta no lo mandó aún
  ctwa_source_id    text,
  ctwa_source_url   text,
  ctwa_headline     text,
  ctwa_source_type  text,
  ctwa_captured_at  timestamptz,
  primer_mensaje    text,

  estado            text not null default 'nuevo'
                    check (estado in ('nuevo', 'lead', 'venta', 'descartado')),
  ultimo_mensaje_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (zernio_account_id, conversation_id)   -- clave de upsert de zernio-sync
);

comment on table public.zernio_conversacion is
  'Una fila por conversación CTWA entrante (vía Zernio). La clasifica el equipo a mano. ctwa_clid es dato de un tercero; esta tabla la lee solo el equipo (RLS es_equipo).';

create index if not exists zernio_conversacion_cuenta_estado_idx
  on public.zernio_conversacion (zernio_account_id, estado);
create index if not exists zernio_conversacion_ultimo_idx
  on public.zernio_conversacion (ultimo_mensaje_at desc nulls last);


-- ── 3 ── Log de cada envío a Meta (auditoría) ──────────────────
--     El feed de Zernio retiene ~30 días; este log es el histórico
--     propio. event_id prefijado con 'zpuente:' para no colisionar con
--     los event_id del camino Meta.
create table if not exists public.zernio_conversion (
  id                uuid primary key default gen_random_uuid(),
  conversacion_id   uuid not null references public.zernio_conversacion(id) on delete cascade,
  zernio_account_id text not null,
  conversation_id   text not null,

  event_name        text not null check (event_name in ('LeadSubmitted', 'Purchase')),
  event_id          text not null unique,   -- 'zpuente:<conversation_id>:<event_name>', dedup
  value             numeric,
  currency          text,

  estado_envio      text not null check (estado_envio in ('enviado', 'fallido', 'sin_clid')),
  events_received   int,
  events_failed     int,
  trace_id          text,                   -- fbtrace_id para Events Manager
  error             jsonb,
  test_code         text,

  created_at        timestamptz not null default now()
);

comment on table public.zernio_conversion is
  'Log de cada envío de conversión a Meta vía Zernio. event_id UNIQUE (zpuente:<conv>:<evento>) = dedup/idempotencia. Supuesto v1: un LeadSubmitted y un Purchase por conversación.';

create index if not exists zernio_conversion_conv_idx
  on public.zernio_conversion (conversacion_id);


-- ── 4 ── RLS: solo el equipo lee y escribe ─────────────────────
--     Las tres tablas, mismo patrón. Sin rama de cliente final: el
--     puente es herramienta del equipo. (El ctwa_clid vive en columna
--     legible por el equipo —no en una tabla service_role-only como en
--     el camino Meta—: es una decisión del spec, el puente es interno.)
alter table public.zernio_cuenta       enable row level security;
alter table public.zernio_conversacion enable row level security;
alter table public.zernio_conversion   enable row level security;

drop policy if exists zernio_cuenta_equipo on public.zernio_cuenta;
create policy zernio_cuenta_equipo on public.zernio_cuenta
  for all to authenticated
  using (public.es_equipo()) with check (public.es_equipo());

drop policy if exists zernio_conversacion_equipo on public.zernio_conversacion;
create policy zernio_conversacion_equipo on public.zernio_conversacion
  for all to authenticated
  using (public.es_equipo()) with check (public.es_equipo());

drop policy if exists zernio_conversion_equipo on public.zernio_conversion;
create policy zernio_conversion_equipo on public.zernio_conversion
  for all to authenticated
  using (public.es_equipo()) with check (public.es_equipo());

-- Nada para anon. authenticated pasa por la policy (es_equipo).
revoke all on public.zernio_cuenta       from anon;
revoke all on public.zernio_conversacion from anon;
revoke all on public.zernio_conversion   from anon;
grant select, insert, update, delete on public.zernio_cuenta       to authenticated;
grant select, insert, update, delete on public.zernio_conversacion to authenticated;
grant select, insert, update, delete on public.zernio_conversion   to authenticated;


-- ── 5 ── Verificación ──────────────────────────────────────────
-- Cuenta sola, no llama a helpers de rol (en el SQL Editor auth.uid()
-- es null y es_equipo() cortaría el script).
select
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name in
       ('zernio_cuenta','zernio_conversacion','zernio_conversion'))              as tablas,          -- 3
  (select count(*) from pg_policies
     where schemaname='public' and tablename like 'zernio_%')                    as policies,        -- 3
  (select count(*) from pg_class
     where relname like 'zernio_%' and relrowsecurity)                           as con_rls,         -- 3
  -- que NO haya tocado nada del camino Meta: esta cuenta es informativa
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='evento_capi')                   as cols_evento_capi_intactas;
