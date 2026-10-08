-- ═══════════════════════════════════════════════════════════════
--  cliente_whatsapp · mapeo phone_number_id → cliente
--  07/10/2026
--
--  Hueco que dejó la 46 (claude_migracion-interno-46-crm-whatsapp):
--  las tablas del CRM (conversacion, mensaje, …) cuelgan de un
--  cliente_id, pero cuando entra un webhook de WhatsApp Cloud API lo
--  único que trae para saber de quién es ese número es el
--  `phone_number_id` (y el `waba_id`). Faltaba la tabla que traduzca
--  uno en otro. Esta es.
--
--  Por qué tabla nueva y no una columna en cliente_integracion:
--    · cliente_integracion no tiene dónde guardar phone_number_id ni
--      waba_id; agregárselas las dejaría en null para toda fila
--      meta_ig / meta_ads, que son todas las que hay.
--    · el UNIQUE global de phone_number_id sale como unique natural de
--      columna acá; en cliente_integracion sería un índice parcial.
--    · la RLS que queremos (lee la agencia, NADA el cliente) es
--      distinta de la de cliente_integracion, que además la consultan
--      sync_diario, los tres pulls y el cron. Tabla aparte = blast
--      radius cero sobre la captura.
--    · es el mismo patrón que la 46 usó para conversacion_pauta y
--      evento_capi: lo de WhatsApp vive en tablas propias con su RLS.
--
--  El webhook (wa-webhook) lee esta tabla con service_role, que saltea
--  RLS. Resuelve SOLO sobre activo = true; si un phone_number_id no
--  mapea a ningún cliente activo, loguea y devuelve 200 sin insertar
--  (Meta manda webhooks de cosas que no pedimos; no queremos que
--  reintente para siempre).
--
--  El verify token y el app secret de Meta NO viven acá: son secrets
--  de Supabase (WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET). Nunca en
--  un .sql ni en el código de la función.
-- ═══════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.cliente_whatsapp') is not null then
    raise exception 'public.cliente_whatsapp ya existe — revisá qué es antes de seguir';
  end if;
end $$;

create table public.cliente_whatsapp (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references public.clientes(id) on delete cascade,

  -- El id del número en la Cloud API. UNIQUE a nivel global a
  -- propósito: un número pertenece a un solo cliente.
  phone_number_id text not null unique,
  waba_id         text,

  activo          boolean not null default true,
  conectado_en    timestamptz not null default now()
);

-- ⚠️ Consecuencia del UNIQUE, dejada escrita a propósito:
-- NO hay histórico acá. Si un número se muda de cliente (p. ej. el
-- cliente deja la agencia y el número pasa a otro), mudarlo es un
-- UPDATE de cliente_id sobre la MISMA fila, no una fila nueva. El
-- unique no deja tener la vieja inactiva + una nueva activa con el
-- mismo phone_number_id. Es la decisión buscada (no queremos histórico
-- de titularidad en esta tabla); el que lo cargue no tiene que pelear
-- con un error de duplicado, solo editar la fila.
comment on table public.cliente_whatsapp is
  'Traduce phone_number_id de WhatsApp Cloud API a cliente. Un número, un cliente (phone_number_id es UNIQUE global). Sin histórico: mudar un número de cliente es UPDATE de cliente_id sobre la misma fila, no una fila nueva.';
comment on column public.cliente_whatsapp.phone_number_id is
  'El id que Meta manda en metadata.phone_number_id del webhook. NO es el número en sí.';
comment on column public.cliente_whatsapp.activo is
  'El webhook resuelve solo sobre activo = true. Apagar un número = dejar de ingestar sus mensajes, sin borrar el mapeo.';

-- El caso del webhook: buscar un cliente por phone_number_id activo.
-- El unique de phone_number_id ya trae índice, pero filtramos por
-- activo, así que uno parcial sobre (phone_number_id) where activo.
create index cliente_whatsapp_activo_idx
  on public.cliente_whatsapp (phone_number_id) where activo;

alter table public.cliente_whatsapp enable row level security;

-- ── RLS ──────────────────────────────────────────────────────────
-- Lectura: la agencia (y super). NADA para el cliente: no hay rama
-- acceso_cliente a propósito. El cliente no tiene por qué ver el
-- phone_number_id ni a qué WABA está atado su número.
drop policy if exists cliente_whatsapp_ver on public.cliente_whatsapp;
create policy cliente_whatsapp_ver on public.cliente_whatsapp
  for select
  to authenticated
  using ( public.es_super() or (public.es_agencia() and public.cliente_de_mi_agencia(cliente_id)) );

-- Escritura: solo super o socia, idéntico a cliente_integracion. Es
-- configuración sensible (atar un número a un cliente), no algo que
-- toque cualquier perfil de agencia. (for all incluye el select de
-- super/socia, que igual son agencia.)
drop policy if exists cliente_whatsapp_escribe on public.cliente_whatsapp;
create policy cliente_whatsapp_escribe on public.cliente_whatsapp
  for all
  to authenticated
  using      ( public.es_super() or public.es_socia() )
  with check ( public.es_super() or public.es_socia() );

-- ── Verificación ─────────────────────────────────────────────────
-- Cuenta sola, no llama a los helpers de rol: en el SQL Editor
-- auth.uid() es null y es_socia() cortaría el script.
select 'cliente_whatsapp creada · ' ||
       (select count(*) from pg_indexes where schemaname='public' and tablename='cliente_whatsapp') || ' índices · ' ||
       (select count(*) from pg_policy pol join pg_class c on c.oid=pol.polrelid
         where c.relname='cliente_whatsapp') || ' policies · rls=' ||
       (select relrowsecurity::text from pg_class where relname='cliente_whatsapp') as resultado;
