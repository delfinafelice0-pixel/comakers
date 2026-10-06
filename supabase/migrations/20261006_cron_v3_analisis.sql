-- ═══════════════════════════════════════════════════════════════
--  sync_diario · v3: suma el análisis del mes cerrado
--
--  ⚠️ ESTE ARCHIVO SE ESCRIBIÓ DESPUÉS DE LOS HECHOS (06/10/2026).
--  La v3 se aplicó a mano en el SQL Editor alrededor del 12/09 y
--  nunca quedó en el repo: las migraciones de este proyecto se
--  corren a mano y Supabase no las registra como aplicadas. Lo que
--  sigue es el volcado VERBATIM de
--
--      select pg_get_functiondef('public.sync_diario'::regproc);
--
--  tomado de la base viva el 06/10/2026. Se guarda tal cual, sin
--  reformatear, justamente para que volver a correr esa consulta y
--  comparar contra este archivo sea un diff de texto limpio. Si
--  alguien edita la función en el SQL Editor, ese diff lo delata.
--
--  Qué cambia respecto de la v2:
--
--  1. Del día 4 al 10 llama a `analizar-reporte` para el mes que
--     cerró. Los pulls de los días 1 a 3 ya trajeron el mes anterior
--     completo, así que para el 4 el reporte está firme. La ventana
--     de 7 días es para que una noche caída no haga perder el mes.
--
--  2. ⚠️ EL CRON ES MÁS ESTRICTO QUE LA FUNCIÓN, A PROPÓSITO.
--     El select exige las tres cosas a la vez: `publicado_en is
--     null`, `analisis_generado_en is null` y `analisis` vacío. O
--     sea que el cron NO pisa ni el texto que escribió una persona
--     ni un borrador que él mismo generó antes. Eso lo vuelve
--     idempotente (cada generación es una llamada paga a la API de
--     Claude), pero tiene una consecuencia que hay que tener
--     presente: un borrador viejo con números que cambiaron después
--     NO lo refresca nunca el cron. Para eso está el camino manual,
--     que sí acepta regenerar un borrador generado: el guardián de
--     analizar-reporte solo devuelve 409 si hay texto Y
--     `analisis_generado_en` es null.
--
--  3. El `search_path` de la versión viva es solo 'public', no
--     `public, extensions, vault` como decía la v2. Funciona porque
--     TODAS las llamadas están calificadas por esquema
--     (`vault.decrypted_secrets`, `net.http_post`). Si algún día se
--     agrega una llamada sin calificar, se rompe acá.
--
--  No hay secretos en este archivo: la service_role key se lee de
--  Vault en tiempo de ejecución (`v_key`) y nunca se escribe. Una
--  service_role key en el repo es una service_role key en GitHub.
--
--  Lo de siempre: el log del cron va a decir timeout y no es un
--  error. El registro que vale es cliente_integracion.ultimo_sync.
--
--  Idempotente. Correr en: Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_diario()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_url    text;
  v_key    text;
  v_ahora  timestamptz := timezone('America/Argentina/Buenos_Aires', now());
  v_meses  text[];
  c        record;
  m        text;
  f        text;
  fns      text[];
  n        int := 0;
  n_org    int := 0;
  n_ads    int := 0;
  clientes int := 0;
  v_dia         int;
  v_mes_cerrado text;
  n_analisis    int := 0;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';

  if v_url is null or v_key is null then
    raise exception 'Faltan project_url y/o service_role_key en Vault.';
  end if;

  v_dia := extract(day from v_ahora);

  -- El mes en curso, siempre. Y los primeros días del mes también el
  -- anterior: si no, el último día de cada mes nunca se sincroniza.
  v_meses := array[ to_char(v_ahora, 'YYYY-MM') ];
  if v_dia <= 3 then
    v_meses := v_meses || to_char(v_ahora - interval '1 month', 'YYYY-MM');
  end if;

  -- Un cliente entra si tiene alguna integración activa. Qué se le
  -- dispara depende de qué módulo tiene prendido y de qué cuenta
  -- tiene conectada: las dos condiciones, no una.
  --
  -- Sin fila en cliente_modulo se asume prendido, que es el contrato
  -- que ya venía usando el panel.
  for c in
    select
      cl.id as cliente_id,
      coalesce(bool_or(ci.tipo = 'meta_ig'  and ci.activo), false) as tiene_ig,
      coalesce(bool_or(ci.tipo = 'meta_ads' and ci.activo), false) as tiene_ads,
      coalesce((select cm.activo from public.cliente_modulo cm
                 where cm.cliente_id = cl.id and cm.modulo = 'organico'), true) as quiere_org,
      coalesce((select cm.activo from public.cliente_modulo cm
                 where cm.cliente_id = cl.id and cm.modulo = 'pauta'), true)    as quiere_ads
    from public.clientes cl
    join public.cliente_integracion ci on ci.cliente_id = cl.id and ci.activo
    group by cl.id
  loop
    fns := array[]::text[];
    if c.tiene_ig  and c.quiere_org then fns := fns || array['pull-instagram', 'pull-posts']; end if;
    if c.tiene_ads and c.quiere_ads then fns := fns || array['pull-ads']; end if;
    if array_length(fns, 1) is null then continue; end if;

    clientes := clientes + 1;

    foreach m in array v_meses loop
      foreach f in array fns loop
        -- Un disparo independiente por cliente, mes y función. Cada
        -- uno arranca con sus propios 150s de límite.
        perform net.http_post(
          url     := v_url || '/functions/v1/' || f,
          headers := jsonb_build_object(
                       'Content-Type', 'application/json',
                       'Authorization', 'Bearer ' || v_key),
          body    := jsonb_build_object('cliente_id', c.cliente_id, 'mes', m),
          timeout_milliseconds := 120000
        );
        n := n + 1;
        if f = 'pull-ads' then n_ads := n_ads + 1; else n_org := n_org + 1; end if;
      end loop;
    end loop;
  end loop;

  -- Análisis del mes cerrado. Del 4 al 10: los pulls de los días 1 a 3
  -- ya trajeron el mes anterior completo, así que para el 4 el reporte
  -- está firme. La ventana de 7 días es para que una noche caída no
  -- haga perder el mes; después del 10 queda el botón manual.
  --
  -- Las tres condiciones juntas hacen que una corrida repetida nunca
  -- pise texto: ni el que generó la función antes, ni el que escribió
  -- alguien a mano.
  if v_dia between 4 and 10 then
    v_mes_cerrado := to_char(v_ahora - interval '1 month', 'YYYY-MM');

    for c in
      select r.cliente_id
        from public.reporte r
       where r.mes = to_date(v_mes_cerrado || '-01', 'YYYY-MM-DD')
         and r.publicado_en is null
         and r.analisis_generado_en is null
         and coalesce(btrim(r.analisis), '') = ''
         and exists (
               select 1 from public.cliente_integracion ci
                where ci.cliente_id = r.cliente_id and ci.activo)
       group by r.cliente_id
    loop
      perform net.http_post(
        url     := v_url || '/functions/v1/analizar-reporte',
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || v_key),
        body    := jsonb_build_object('cliente_id', c.cliente_id, 'mes', v_mes_cerrado),
        timeout_milliseconds := 120000
      );
      n_analisis := n_analisis + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'disparos', n, 'instagram', n_org, 'ads', n_ads,
    'analisis', n_analisis, 'mes_analizado', v_mes_cerrado,
    'clientes', clientes, 'meses', v_meses, 'cuando', now());
end
$function$;

comment on function public.sync_diario() is
  'La dispara el cron pull-diario. Lanza los pulls de Meta según qué módulos tenga prendidos cada cliente, y del día 4 al 10 el análisis del mes cerrado. No espera respuesta: el resultado real queda en cliente_integracion.ultimo_sync / ultimo_error y en reporte.analisis_generado_en.';

-- Sin esto, cualquier usuario logueado podía dispararla (y con ella,
-- llamadas pagas a la API de Claude). Ver SEGURIDAD-pendientes.md § 2.
revoke all on function public.sync_diario() from public;
revoke all on function public.sync_diario() from anon, authenticated;

-- ── Verificación ────────────────────────────────────────────────
-- Cuenta sola: no llama a ninguna función guardada. En el SQL Editor
-- no hay usuaria logueada y auth.uid() es null, así que una llamada a
-- es_socia() cortaría el script y desharía los create de arriba.
select
  p.oid::regprocedure                                       as funcion,
  p.prosecdef                                               as security_definer,
  pg_get_functiondef(p.oid) ilike '%analizar-reporte%'       as llama_a_analizar_reporte,
  pg_get_functiondef(p.oid) ilike '%pull-ads%'               as llama_a_pull_ads,
  pg_get_functiondef(p.oid) ilike '%pull-instagram%'         as llama_a_pull_instagram,
  has_function_privilege('authenticated', p.oid, 'execute')  as la_puede_llamar_authenticated,
  has_function_privilege('anon', p.oid, 'execute')           as la_puede_llamar_anon
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'sync_diario';
-- Esperado: security_definer = true, las tres llamadas = true,
-- y los dos has_function_privilege = false.
