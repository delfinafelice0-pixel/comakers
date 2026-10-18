-- ═══════════════════════════════════════════════════════════════
--  Agendar enviar-capi en pg_cron
--
--  CORRER DESPUÉS de deployar la Edge Function enviar-capi. Separado
--  de la migración crm-01 a propósito: crm-01 es cambio de esquema;
--  esto es agendar un disparo. Si algo falla, que se sepa cuál fue.
--
--  Si se corre antes del deploy no corrompe nada: el net.http_post
--  daría 404 y las filas seguirían pendientes. Pero conviene el orden.
--
--  El disparo va cada 5 minutos: no en el insert, para poder agrupar y
--  reintentar. La función agarra hasta 500 pendientes por corrida.
--
--  Mismo patrón que sync_diario: una función SECURITY DEFINER que lee
--  los secrets del Vault y hace el POST con el service_role. El cron no
--  puede leer el Vault por su cuenta.
--
--  Idempotente: desagenda antes de reagendar.
-- ═══════════════════════════════════════════════════════════════

-- ── 0 ── Que estén las extensiones y los secrets ───────────────
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'Falta la extensión pg_cron.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'Falta la extensión pg_net (net.http_post).';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url') then
    raise exception 'Falta el secret project_url en Vault.';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'service_role_key') then
    raise exception 'Falta el secret service_role_key en Vault.';
  end if;
end $$;


-- ── 1 ── El disparador ─────────────────────────────────────────
create or replace function public.disparar_enviar_capi()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    raise exception 'Faltan project_url y/o service_role_key en Vault.';
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/enviar-capi',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end
$function$;

comment on function public.disparar_enviar_capi() is
  'La dispara el cron enviar-capi cada 5 min. Llama a la Edge Function enviar-capi con el service_role (que la función exige en Authorization).';

-- Que no la pueda disparar cualquier usuario logueado.
revoke all on function public.disparar_enviar_capi() from public, anon, authenticated;


-- ── 2 ── Agendar (desagendando antes, por si ya estaba) ────────
select cron.unschedule('enviar-capi')
  where exists (select 1 from cron.job where jobname = 'enviar-capi');

select cron.schedule('enviar-capi', '*/5 * * * *', $$select public.disparar_enviar_capi();$$);


-- ── 3 ── Verificación ──────────────────────────────────────────
select jobid, jobname, schedule, active
  from cron.job where jobname = 'enviar-capi';
