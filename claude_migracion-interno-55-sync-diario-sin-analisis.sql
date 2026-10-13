-- ═══════════════════════════════════════════════════════════════
--  sync_diario · v5: sin el análisis automático
--  13/10/2026
--
--  Los análisis los escribe el equipo a mano (con su propia
--  suscripción de Claude), así que ya no se paga la API para
--  generarlos. Esta versión es IDÉNTICA a la v4
--  (20261007_sync_diario_v4_desacople_modulos.sql) salvo que se saca
--  el bloque que, del día 4 al 10, llamaba a la Edge Function
--  analizar-reporte. Las sincronizaciones de datos (pull-instagram,
--  pull-posts, pull-ads) quedan EXACTAMENTE igual.
--
--  analizar-reporte NO se borra: queda deployada por si algún día se
--  quiere volver. Simplemente ya nadie la llama (ni el cron ni el
--  panel, que también le sacó los botones).
--
--  Se sacaron también las variables que solo usaba ese bloque
--  (v_mes_cerrado, n_analisis) y los campos del return que las
--  reportaban.
--
--  Idempotente (CREATE OR REPLACE). El cron 'pull-diario' sigue
--  llamando a esta misma función, ahora sin el análisis. Correr en:
--  Supabase → SQL Editor.
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
  v_dia    int;
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

  -- Un cliente entra si tiene alguna integración activa, y lo que se le
  -- dispara depende SOLO de qué cuenta tiene conectada (no se mira
  -- cliente_modulo: apagar un módulo es "que el cliente no lo vea", no
  -- "dejá de traer datos" — el hueco de los 90 días de Instagram no se
  -- recupera).
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
        -- Un disparo independiente por cliente, mes y función. Cada uno
        -- arranca con sus propios 150s de límite.
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

  -- v5: acá iba el bloque del análisis del mes cerrado (del 4 al 10
  -- llamaba a analizar-reporte). Se sacó: el análisis lo escribe el
  -- equipo a mano.

  return jsonb_build_object(
    'disparos', n, 'instagram', n_org, 'ads', n_ads,
    'clientes', clientes, 'meses', v_meses, 'cuando', now());
end
$function$;

comment on function public.sync_diario() is
  'La dispara el cron pull-diario. Lanza SOLO los pulls de Meta según qué integraciones activas tenga cada cliente. v5: se sacó el análisis automático (ya no se paga la API de Claude; el equipo lo escribe a mano). analizar-reporte queda deployada pero esta función ya no la llama.';

-- Sin esto, cualquier usuario logueado podía dispararla. Ver
-- SEGURIDAD-pendientes.md § 2.
revoke all on function public.sync_diario() from public;
revoke all on function public.sync_diario() from anon, authenticated;

-- ── Verificación ────────────────────────────────────────────────
-- La definición guardada INCLUYE los comentarios del cuerpo, y el de
-- arriba nombra "analizar-reporte": por eso se mira el código sin
-- comentarios (si no, daría true aunque ya no la llame).
-- Verificación completa (permisos y cron): claude_consulta-sync-diario.sql
with c as (select regexp_replace(pg_get_functiondef('public.sync_diario()'::regprocedure), '--[^\n]*', '', 'g') as codigo)
select
  codigo ilike '%analizar-reporte%'  as todavia_llama_analisis, -- false
  codigo ilike '%pull-ads%'          as llama_pull_ads,         -- true
  codigo ilike '%pull-instagram%'    as llama_pull_instagram,   -- true
  codigo ilike '%pull-posts%'        as llama_pull_posts        -- true
from c;
