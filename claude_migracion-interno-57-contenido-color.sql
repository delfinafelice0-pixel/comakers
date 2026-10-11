-- ═══════════════════════════════════════════════════════════════
--  migracion-interno-57 · color propio de cada tarjeta del Calendario
--  11/10/2026
--
--  cal_contenido.color: un color elegido de la paleta de la marca para
--  esa tarjeta. Vacío = usa el color de su categoría, como hasta ahora.
--  Solo se acepta un color hex (#RRGGBB): nada de texto libre que
--  termine adentro de un atributo style.
--
--  Idempotente. Correr en: Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

begin;

alter table public.cal_contenido add column if not exists color text;

alter table public.cal_contenido drop constraint if exists cal_contenido_color_hex;
alter table public.cal_contenido add constraint cal_contenido_color_hex
  check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');

comment on column public.cal_contenido.color is
  'Color propio de la tarjeta (#RRGGBB, de la paleta de la marca). Null = el de la categoría.';

commit;

-- Verificación: la columna y la restricción existen.
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'cal_contenido' and column_name = 'color';
