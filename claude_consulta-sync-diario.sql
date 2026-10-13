-- ═══════════════════════════════════════════════════════════════
--  Verificar sync_diario · SOLO LECTURA · 13/10/2026
--
--  Ojo: la definición guardada incluye los comentarios del cuerpo, y
--  ahí SÍ aparecen "cliente_modulo" y "analizar-reporte" (para explicar
--  por qué ya no se usan). Por eso se mira el código SIN comentarios.
-- ═══════════════════════════════════════════════════════════════
with d as (
  select pg_get_functiondef('public.sync_diario()'::regprocedure) as def
), c as (
  select def, regexp_replace(def, '--[^\n]*', '', 'g') as codigo from d
)
select
  codigo ilike '%cliente_modulo%'                       as usa_cliente_modulo,         -- tiene que dar false
  codigo ilike '%analizar-reporte%'                     as llama_analizar_reporte,     -- false
  codigo ilike '%pull-instagram%' and codigo ilike '%pull-posts%' and codigo ilike '%pull-ads%'
                                                        as llama_los_tres_pulls,       -- true
  codigo ilike '%join public.cliente_integracion%'      as es_la_v4_o_posterior,       -- true (v4: entra por integración activa)
  has_function_privilege('anon', 'public.sync_diario()', 'execute')          as anon_puede_ejecutar,          -- false
  has_function_privilege('authenticated', 'public.sync_diario()', 'execute') as authenticated_puede_ejecutar, -- false
  (select string_agg(jobname || ' · ' || schedule || ' · ' || command, ' | ')
     from cron.job where command ilike '%sync_diario%')  as cron_que_la_llama
from c;
