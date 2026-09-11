-- ═══════════════════════════════════════════════════════════════
--  Sincronización diaria de Instagram
--
--  Todas las noches a las 3:00 de Argentina dispara pull-instagram y
--  pull-posts para cada cliente con integración activa, sobre el mes
--  en curso. Así el mes se va llenando solo en vez de esperar a que
--  alguien apriete un botón.
--
--  ⚠️ REQUIERE que existan estos dos secretos en Vault:
--       project_url
--       service_role_key
--     Se cargan A MANO en el SQL Editor, NUNCA en una migración: la
--     service_role key en el repo es la service_role key en GitHub.
--
--  ⚠️ EL LOG DEL CRON VA A DECIR TIMEOUT Y NO ES UN ERROR.
--     pg_net no espera a que la función termine, y las funciones
--     tardan bastante más que el disparo. El registro que vale es
--     `cliente_integracion.ultimo_sync` / `ultimo_error`, que cada
--     pull escribe cuando de verdad terminó.
-- ═══════════════════════════════════════════════════════════════

-- Acá `if not exists` es legítimo: son extensiones compartidas, no
-- objetos nuestros, y Supabase ya suele traerlas puestas.
create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ───────────────────────────────────────────────────────────────
--  La función
--
--  security definer porque necesita leer Vault, que un rol común no
--  puede. Por eso mismo se le revoca el execute a todo el mundo unas
--  líneas más abajo: no devuelve la clave, pero sin eso cualquier
--  usuario logueado podría dispararla por RPC y gastar cuota de Meta.
-- ───────────────────────────────────────────────────────────────
create or replace function public.sync_diario()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url    text;
  v_key    text;
  v_ahora  timestamptz := timezone('America/Argentina/Buenos_Aires', now());
  v_meses  text[];
  v_fns    text[] := array['pull-instagram', 'pull-posts'];
  c        record;
  m        text;
  f        text;
  n        int := 0;
  clientes int := 0;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';

  if v_url is null or v_key is null then
    raise exception 'Faltan project_url y/o service_role_key en Vault. Ver el encabezado de esta migración.';
  end if;

  -- El mes en curso, siempre.
  v_meses := array[ to_char(v_ahora, 'YYYY-MM') ];

  -- Y los primeros días del mes, también el anterior. Si no, el
  -- último día de cada mes nunca se sincroniza: el 1° a las 3am el
  -- mes ya cambió y nadie vuelve a mirar atrás.
  if extract(day from v_ahora) <= 3 then
    v_meses := v_meses || to_char(v_ahora - interval '1 month', 'YYYY-MM');
  end if;

  for c in
    select cliente_id
      from public.cliente_integracion
     where tipo = 'meta_ig' and activo = true
  loop
    clientes := clientes + 1;
    foreach m in array v_meses loop
      foreach f in array v_fns loop
        -- Un disparo independiente por cliente, mes y función. Cada
        -- uno arranca con sus propios 150s de límite; una función
        -- maestra que hiciera todo chocaría contra el techo.
        perform net.http_post(
          url     := v_url || '/functions/v1/' || f,
          headers := jsonb_build_object(
                       'Content-Type', 'application/json',
                       'Authorization', 'Bearer ' || v_key),
          body    := jsonb_build_object('cliente_id', c.cliente_id, 'mes', m),
          timeout_milliseconds := 120000
        );
        n := n + 1;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object(
    'disparos', n, 'clientes', clientes, 'meses', v_meses, 'cuando', now());
end $$;

comment on function public.sync_diario() is
  'La dispara el cron pull-diario. Lanza los pulls de Instagram y no espera respuesta: el resultado real queda en cliente_integracion.ultimo_sync / ultimo_error.';

revoke all on function public.sync_diario() from public;
revoke all on function public.sync_diario() from anon, authenticated;


-- ───────────────────────────────────────────────────────────────
--  El cron · 06:00 UTC = 03:00 en Argentina
--  pg_cron piensa en UTC. Argentina no tiene horario de verano, así
--  que las tres de la mañana son las tres de la mañana todo el año.
-- ───────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'pull-diario') then
    perform cron.unschedule('pull-diario');
  end if;
end $$;

select cron.schedule('pull-diario', '0 6 * * *', 'select public.sync_diario();');


-- ───────────────────────────────────────────────────────────────
--  Confirmación
-- ───────────────────────────────────────────────────────────────
select j.jobname, j.schedule, j.active, j.command,
       (select count(*) from public.cliente_integracion
         where tipo = 'meta_ig' and activo = true) as clientes_que_entran
  from cron.job j
 where j.jobname = 'pull-diario';
