-- ============================================================
--  Tres solapas: Cuenta · Orgánico · Pauta
--  13/09/2026
--
--  `analisis` pasa a ser el texto de la solapa CUENTA: la lectura
--  general que cruza contenido propio y pauta. No se renombra a
--  propósito — el panel ya la lee y renombrarla lo rompe hoy para
--  ganar prolijidad mañana.
--
--  Se suman dos columnas para las otras dos solapas.
--  `resumen` y `proximos_pasos` ya existían y nunca se llenaron.
-- ============================================================

alter table public.reporte
  add column if not exists analisis_organico text,
  add column if not exists analisis_pauta    text;

comment on column public.reporte.analisis is
  'Solapa Cuenta: la lectura general del mes, cruzando orgánico y pauta. '
  'Borrador generado por analizar-reporte hasta que alguien lo edita.';
comment on column public.reporte.analisis_organico is
  'Solapa Orgánico: análisis del contenido propio.';
comment on column public.reporte.analisis_pauta is
  'Solapa Pauta: análisis de la inversión publicitaria.';
comment on column public.reporte.resumen is
  'Dos líneas arriba de todo: qué pasó este mes. Lo primero que lee el cliente.';
comment on column public.reporte.proximos_pasos is
  'Qué conviene sostener y qué conviene incorporar el mes que viene. '
  'Propuesta para que la agencia la evalúe, no un compromiso con el cliente.';


-- ── Verificación. Tiene que devolver las cinco filas. ────────
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'reporte'
   and column_name in ('analisis','analisis_organico','analisis_pauta',
                       'resumen','proximos_pasos')
 order by column_name;
