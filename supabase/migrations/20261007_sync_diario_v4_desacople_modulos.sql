-- ═══════════════════════════════════════════════════════════════
--  sync_diario · v4: los pulls dependen solo de cliente_integracion
--  07/10/2026
--
--  Parte de la definición viva guardada en
--  20261006_cron_v3_analisis.sql (volcado verbatim de la base). El
--  ÚNICO cambio respecto de la v3 es a quién se le dispara cada pull.
--
--  Por qué: con el popup nuevo de administración, apagar un módulo
--  (cliente_modulo) es "que el cliente no lo vea". Pero la v3 usaba
--  cliente_modulo para decidir también QUÉ PULLS DISPARAR
--  (quiere_org / quiere_ads). Entonces apagar un módulo cortaba la
--  descarga — y la API de Instagram solo da 90 días hacia atrás, así
--  que ese hueco no se recupera nunca.
--
--  v4 desacopla: un pull se dispara si el cliente tiene la integración
--  ACTIVA de ese tipo, y nada más. cliente_modulo deja de decidir qué
--  se trae; solo decide qué ve el cliente en el panel.
--
--    tiene_ig  (meta_ig  activo) → pull-instagram + pull-posts
--    tiene_ads (meta_ads activo) → pull-ads
--
--  ⚠️ ESTO SOLO TOCA sync_diario. pull-ads TODAVÍA se auto-corta si el
--  módulo pauta está apagado (chequeo interno de la función). Para que
--  el desacople sea completo hay que DEPLOYAR pull-ads sin ese chequeo
--  (es un deploy de edge function, no una migración). pull-instagram
--  no corta la descarga (solo usa pauta para el campo `alcance`) y
--  analizar-reporte usa cliente_modulo para la SALIDA del análisis, no
--  para la captura: esos dos se dejan.
--
--  Todo lo demás (bloque de análisis del mes cerrado, revokes,
--  verificación) queda igual que la v3.
--
--  El resto del contexto de la v3 sigue valiendo: el log del cron dice
--  timeout y no es error; el registro que vale es
--  cliente_integracion.ultimo_sync. No hay secretos acá: la
--  service_role key se lee de Vault en ejecución.
--
--  Idempotente (CREATE OR REPLACE). Correr en: Supabase → SQL Editor.
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

  -- v4: un cliente entra si tiene alguna integración activa, y lo que
  -- se le dispara depende SOLO de qué cuenta tiene conectada. Ya no se
  -- mira cliente_modulo acá: apagar un módulo es "que el cliente no lo
  -- vea", no "dejá de traer datos" — el hueco de los 90 días de
  -- Instagram no se recupera.
  for c in
    select
      cl.id as cliente_id,
      coalesce(bool_or(ci.tipo = 'meta_ig'  and ci.activo), false) as tiene_ig,
      coalesce(bool_or(ci.tipo = 'meta_ads' and ci.activo), false) as tiene_ads
    from public.clientes cl
    join public.cliente_integracion ci on ci.cliente_id = cl.id and ci.activo
    group by cl.id
  loop
    fns := array[]::text[];
    if c.tiene_ig  then fns := fns || array['pull-instagram', 'pull-posts']; end if;
    if c.tiene_ads then fns := fns || array['pull-ads']; end if;
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
  'La dispara el cron pull-diario. Lanza los pulls de Meta según qué integraciones activas tenga cada cliente (v4: ya NO mira cliente_modulo para decidir qué traer), y del día 4 al 10 el análisis del mes cerrado. No espera respuesta: el resultado real queda en cliente_integracion.ultimo_sync / ultimo_error y en reporte.analisis_generado_en.';

-- Sin esto, cualquier usuario logueado podía dispararla (y con ella,
-- llamadas pagas a la API de Claude). Ver SEGURIDAD-pendientes.md § 2.
revoke all on function public.sync_diario() from public;
revoke all on function public.sync_diario() from anon, authenticated;

-- ── Verificación ────────────────────────────────────────────────
-- Cuenta sola: no llama a ninguna función guardada. En el SQL Editor
-- no hay usuaria logueada y auth.uid() es null, así que una llamada a
-- es_socia() cortaría el script y desharía los create de arriba.
--
-- v4: además de lo de siempre, confirmamos que la definición YA NO
-- menciona cliente_modulo (tiene que dar false).
select
  p.oid::regprocedure                                       as funcion,
  p.prosecdef                                               as security_definer,
  pg_get_functiondef(p.oid) ilike '%cliente_modulo%'        as todavia_mira_cliente_modulo,
  pg_get_functiondef(p.oid) ilike '%analizar-reporte%'       as llama_a_analizar_reporte,
  pg_get_functiondef(p.oid) ilike '%pull-ads%'               as llama_a_pull_ads,
  pg_get_functiondef(p.oid) ilike '%pull-instagram%'         as llama_a_pull_instagram,
  has_function_privilege('authenticated', p.oid, 'execute')  as la_puede_llamar_authenticated,
  has_function_privilege('anon', p.oid, 'execute')           as la_puede_llamar_anon
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'sync_diario';
-- Esperado: security_definer = true, todavia_mira_cliente_modulo = FALSE,
-- las tres llamadas = true, y los dos has_function_privilege = false.
