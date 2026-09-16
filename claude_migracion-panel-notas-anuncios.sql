-- ═══════════════════════════════════════════════════════════════
--  Panel de reportes · notas de la agencia sobre anuncios
--
--  Guarda, por reporte, lo que la agencia escribe sobre cada anuncio:
--    "Por qué creemos que funcionó"  (sección Lo que mejor funcionó)
--    "Qué hicimos"                   (sección Lo que ajustamos)
--
--  Forma:  { "<ad_id>": { "tipo": "mejor" | "ajuste",
--                         "texto": "...",
--                         "escrita_en": "2026-09-16T..." } }
--
--  Por qué en `reporte` y no en `anuncio_meta`:
--   - pull-ads reescribe anuncio_meta todas las noches.
--   - Acá hereda la RLS del reporte: el cliente no ve las notas de un
--     mes en borrador, igual que las secciones de `bloques`.
--
--  Idempotente: se puede correr dos veces.
--  Correr en: Supabase → SQL Editor. ANTES de subir el panel nuevo
--  (si se sube antes no se rompe nada: las notas no cargan y guardar
--  avisa que falta esta migración).
-- ═══════════════════════════════════════════════════════════════

alter table public.reporte
  add column if not exists notas_anuncios jsonb not null default '{}'::jsonb;

comment on column public.reporte.notas_anuncios is
  'Notas de la agencia por anuncio de Meta Ads: {ad_id: {tipo: mejor|ajuste, texto, escrita_en}}. La escribe panel.html.';

-- ── Verificación ────────────────────────────────────────────────
-- 1) La columna existe, con su default.
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'reporte' and column_name = 'notas_anuncios';

-- 2) Los usuarios logueados pueden leerla y escribirla.
--    Tiene que devolver SELECT y UPDATE para authenticated.
--    Si viene vacío, la tabla usa permisos por columna y hay que
--    avisar antes de subir el panel.
select grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'reporte'
  and column_name = 'notas_anuncios' and grantee = 'authenticated'
order by privilege_type;
