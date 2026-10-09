-- ═══════════════════════════════════════════════════════════════
--  PANEL INTERNO · CoMakers — Parte 53
--  Responder desde el panel, SOLO dentro de la ventana gratis.
--
--  ── Qué prepara esta migración ──────────────────────────────
--
--  La Edge Function wa-enviar va a dejar responder una conversación,
--  pero nada más dentro de la ventana de 72 h sin costo que abre un
--  clic a un anuncio Click-to-WhatsApp. El módulo se vende como costo
--  cero: mandar fuera de esa ventana se cobra a tarifa utility, así
--  que el panel no lo hace.
--
--  Esta migración no manda nada. Deja dos cosas que wa-enviar y el
--  panel necesitan:
--
--  1. outbox_envio — idempotencia. Meta NO deduplica los envíos por su
--     cuenta, y el wa_id del mensaje recién existe cuando Meta
--     responde, así que no puede ser la clave de dedupe. El panel
--     manda una idem_key (uuid) por intento; wa-enviar la reclama acá
--     ANTES de llamar a Meta. Dos clicks con la misma idem_key = un
--     solo envío.
--
--  2. ventana_crm(uuid) — el panel no lee conversacion_pauta (es
--     service_role: ahí vive el ctwa_clid, dato de un tercero). Pero
--     necesita saber si puede responder gratis. Este RPC se lo dice
--     sin exponer el clid: devuelve solo (abierta, vence_en).
--
--  ── La regla de la ventana, bien ────────────────────────────
--
--  72 h desde conversacion_pauta.recibido_en (cuando llegó el
--  referral), NO desde el último mensaje entrante. La de 24 h que se
--  renueva con cada entrante es la ventana de SERVICIO, que es otro
--  permiso y que desde el 01/10/2026 se cobra. Contar desde el
--  referral es más restrictivo que lo de Meta (que cuenta desde la
--  primera respuesta calificada): erramos para el lado seguro.
--
--  SIN transacción envolvente. Correr entera. Idempotente.
-- ═══════════════════════════════════════════════════════════════


-- ── 0 ── Que esté lo que las reglas necesitan ──────────────────
do $$
declare v_falta text := '';
begin
  if to_regclass('public.conversacion')       is null then v_falta := v_falta || ' conversacion';       end if;
  if to_regclass('public.conversacion_pauta')  is null then v_falta := v_falta || ' conversacion_pauta';  end if;
  if to_regprocedure('public.es_equipo()')            is null then v_falta := v_falta || ' es_equipo()';            end if;
  if to_regprocedure('public.cliente_de_mi_agencia(uuid)') is null then v_falta := v_falta || ' cliente_de_mi_agencia(uuid)'; end if;
  if to_regprocedure('public.cliente_ve_crm(uuid)')   is null then v_falta := v_falta || ' cliente_ve_crm(uuid)';   end if;
  if v_falta <> '' then
    raise exception 'Parte 53: falta%. No corro nada.', v_falta;
  end if;
end $$;


-- ── 1 ── La cola de envíos (idempotencia + auditoría) ──────────
--     Como conversacion_pauta y evento_capi: RLS prendida, cero
--     policies. Solo el service_role de wa-enviar la toca. El navegador
--     nunca la lee ni la escribe; manda la idem_key en el body y listo.
create table if not exists public.outbox_envio (
  idem_key        uuid primary key,
  conversacion_id uuid not null references public.conversacion(id) on delete cascade,
  texto           text not null,

  -- 'enviando' = reclamado, todavía sin respuesta de Meta.
  estado          text not null default 'enviando'
                  check (estado in ('enviando', 'ok', 'error')),
  wa_id           text,          -- el wamid que devolvió Meta, si salió
  detalle         text,          -- el error de Meta, si falló
  intentos        int not null default 0,

  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

comment on table public.outbox_envio is
  'Dedupe y auditoría de los envíos de wa-enviar. idem_key la genera el panel; se reclama antes de llamar a Meta. RLS sin policies: solo service_role.';
comment on column public.outbox_envio.idem_key is
  'uuid por intento de envío. Dos clicks con la misma = un solo envío a Meta.';

create index if not exists outbox_envio_conv_idx
  on public.outbox_envio (conversacion_id, creado_en);

alter table public.outbox_envio enable row level security;
-- (a propósito: cero policies)
revoke all on public.outbox_envio from authenticated, anon;


-- ── 2 ── ¿Puedo responder gratis esta conversación? ────────────
--     security definer: salta la RLS para poder leer
--     conversacion_pauta, PERO chequea a mano que el que pregunta
--     pueda ver la conversación (los mismos predicados que la policy
--     conversacion_ver). Nunca devuelve el clid: solo si la ventana
--     está abierta y hasta cuándo.
create or replace function public.ventana_crm(c_id uuid)
returns table (abierta boolean, vence_en timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_puede    boolean;
  v_recibido timestamptz;
begin
  -- auth.uid() sigue siendo el del que llama aunque esto sea security
  -- definer: el claim viaja a nivel de request, no de rol.
  select exists (
    select 1 from public.conversacion c
     where c.id = c_id
       and ( (public.es_equipo() and public.cliente_de_mi_agencia(c.cliente_id))
             or public.cliente_ve_crm(c.cliente_id) )
  ) into v_puede;

  if not v_puede then
    return query select false, null::timestamptz;
    return;
  end if;

  select cp.recibido_en into v_recibido
    from public.conversacion_pauta cp
   where cp.conversacion_id = c_id;

  if v_recibido is null then
    -- No vino por un anuncio: no hay ventana gratis.
    return query select false, null::timestamptz;
  else
    return query select (now() - v_recibido < interval '72 hours'),
                        (v_recibido + interval '72 hours');
  end if;
end $$;

comment on function public.ventana_crm(uuid) is
  'Le dice al panel si una conversación está dentro de la ventana gratis de 72 h (desde conversacion_pauta.recibido_en) y hasta cuándo. No expone el ctwa_clid. wa-enviar revalida igual: esto es la pista de UI.';

revoke all on function public.ventana_crm(uuid) from public, anon;
grant execute on function public.ventana_crm(uuid) to authenticated;


-- ── 3 ── Qué quedó ─────────────────────────────────────────────
do $$
begin
  raise notice 'Parte 53 lista. outbox_envio (RLS, cero policies) + ventana_crm(uuid). wa-enviar y el panel la usan; sin esto no mandan nada.';
end $$;
