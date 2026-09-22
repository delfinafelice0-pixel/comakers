-- ═══════════════════════════════════════════════════════════════
--  Métricas de cuenta de Instagram  ·  22/09/2026
--
--  Las escribe pull-instagram. Todo lo que no llega queda en null:
--  null es "no sabemos", 0 es "no pasó". No son lo mismo.
--
--  Tres familias, con reglas distintas:
--
--  1) CONTEOS del mes (visitas, clics, vistas): se suman sin
--     problema aunque el mes se parta en dos consultas.
--
--  2) PERSONAS ÚNICAS (alcance por tipo, cuentas que interactuaron):
--     sumar dos ventanas contaría dos veces a la misma persona. Por
--     eso se toman de la PRIMERA ventana y se guarda en `unicos_dias`
--     cuántos días cubre. En meses de 31 días van a decir 30: el
--     panel tiene que mostrarlo así ("30 de 31 días"), nunca como si
--     fuera el mes completo.
--
--  3) FOTO DEL MOMENTO (seguidores totales, demografía): la API dice
--     cuántos hay HOY, no cuántos había el 31 de agosto. No se puede
--     reconstruir hacia atrás: empieza a acumularse desde ahora. Cada
--     una guarda cuándo se tomó, para que el panel pueda decir "al 30
--     de septiembre".
--
--  Idempotente. Correr en: Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

alter table public.reporte
  -- 1) Conteos del mes
  add column if not exists visitas_perfil_org        integer,
  add column if not exists clics_web_org             integer,
  add column if not exists views_seguidores_org      integer,
  add column if not exists views_no_seguidores_org   integer,
  -- 2) Personas únicas + cobertura
  add column if not exists reach_seguidores_org      integer,
  add column if not exists reach_no_seguidores_org   integer,
  add column if not exists cuentas_interactuaron_org integer,
  add column if not exists unicos_dias               integer,
  -- 3) Fotos del momento
  add column if not exists seguidores_total          integer,
  add column if not exists seguidores_total_en       timestamptz,
  add column if not exists demografia_org            jsonb,
  add column if not exists demografia_org_en         timestamptz,
  -- Horarios: se guarda pero todavía NO se muestra (falta confirmar
  -- en qué huso vienen las horas que manda Meta).
  add column if not exists conectados_hora           jsonb,
  add column if not exists conectados_hora_en        timestamptz;

comment on column public.reporte.visitas_perfil_org is
  'profile_views del mes. Conteo, se suma entre ventanas.';
comment on column public.reporte.clics_web_org is
  'website_clicks: toques en el enlace de la bio.';
comment on column public.reporte.views_seguidores_org is
  'Vistas que vinieron de seguidores (breakdown follow_type).';
comment on column public.reporte.views_no_seguidores_org is
  'Vistas que vinieron de gente que no sigue la cuenta.';
comment on column public.reporte.reach_seguidores_org is
  'Personas únicas alcanzadas que ya seguían. Cubre unicos_dias días, no siempre el mes entero.';
comment on column public.reporte.reach_no_seguidores_org is
  'Personas únicas alcanzadas que no seguían. Ver unicos_dias.';
comment on column public.reporte.cuentas_interactuaron_org is
  'accounts_engaged: cuentas únicas que interactuaron. Ver unicos_dias.';
comment on column public.reporte.unicos_dias is
  'Cuántos días cubren las métricas de personas únicas. En meses de 31 días son 30: el endpoint de Meta no acepta rangos más largos y sumar dos ventanas duplicaría personas.';
comment on column public.reporte.seguidores_total is
  'Seguidores al momento de la foto (followers_count). NO es del mes: ver seguidores_total_en.';
comment on column public.reporte.demografia_org is
  'Foto de quién sigue la cuenta: {edad, genero, ciudad (top 20), pais}. Meta la devuelve solo con 100+ seguidores.';
comment on column public.reporte.conectados_hora is
  'Promedio de seguidores conectados por hora (0–23) durante el mes. Huso horario sin confirmar: no mostrar todavía.';

-- ── Verificación ────────────────────────────────────────────────
-- 1) Las 14 columnas nuevas existen.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'reporte'
   and column_name in ('visitas_perfil_org','clics_web_org','views_seguidores_org',
       'views_no_seguidores_org','reach_seguidores_org','reach_no_seguidores_org',
       'cuentas_interactuaron_org','unicos_dias','seguidores_total','seguidores_total_en',
       'demografia_org','demografia_org_en','conectados_hora','conectados_hora_en')
 order by column_name;

-- 2) Se pueden leer y escribir (tiene que devolver SELECT y UPDATE).
select distinct privilege_type
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'reporte'
   and column_name = 'seguidores_total' and grantee = 'authenticated'
 order by privilege_type;
