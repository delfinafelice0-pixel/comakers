-- ═══════════════════════════════════════════════════════════════
--  Pauta de Meta · parte 2: desglose por objetivo
--  08/10/2026
--
--  Una sola columna nueva: `reporte.desglose_ads` (jsonb).
--
--  Hasta ahora el reporte guardaba UN titular de pauta (resultados_ads /
--  accion_ads / costo_resultado_ads), como si toda la cuenta optimizara
--  lo mismo. Cuando un cliente corre campañas con objetivos distintos
--  (p. ej. ventas + mensajes), ese único número mezcla cosas que no se
--  comparan.
--
--  pull-ads ahora lee el OBJETIVO de cada campaña, agrupa por objetivo y,
--  SOLO cuando hay más de uno, escribe acá el desglose: un arreglo de
--  grupos { accion, etiqueta, objetivo, campanias, inversion, resultados,
--  costo_resultado, reach, impresiones, clics, ctr, cpm }. Con un solo
--  objetivo queda null y el titular de siempre alcanza.
--
--  El panel lo lee en una consulta aparte (si esta migración no corrió,
--  esa consulta falla sola y el panel sigue andando con el titular). El
--  snapshot del mes publicado clona la fila entera, así que el desglose
--  queda congelado junto con el resto.
--
--  Idempotente. Correr en: Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

alter table public.reporte
  add column if not exists desglose_ads jsonb;

comment on column public.reporte.desglose_ads is
  'Pauta abierta por objetivo cuando la cuenta mezcla objetivos (ventas, mensajes, leads, tráfico…). Arreglo de grupos con sus totales. Null = un solo objetivo (alcanza el titular resultados_ads/accion_ads).';

-- Verificación: la columna existe y es jsonb.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'reporte'
  and column_name = 'desglose_ads';
