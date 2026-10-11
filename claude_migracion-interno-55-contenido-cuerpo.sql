-- ═══════════════════════════════════════════════════════════════
--  migracion-interno-55 · ficha de contenido del Calendario: un solo
--  campo de texto con formato
--  11/10/2026
--
--  La ficha pasa de varios campos (copy, referencias, link) a UN campo
--  con formato: cal_contenido.cuerpo. Se guarda texto con marcas
--  (**negrita**, [texto](url), "# Título", listas) — nunca HTML: el
--  HTML lo arma el panel escapando todo primero (mismo editor que
--  /interno).
--
--  Lo que ya estaba cargado se pasa al campo nuevo, uno abajo del otro
--  con su título, para que no se pierda nada. Solo donde `cuerpo` está
--  vacío: correrla dos veces no duplica.
--
--  NO se borra nada: copy, referencias y link quedan en la base (el
--  panel ya no los muestra). Tampoco aprob_agencia / aprob_cliente
--  (los checks se ocultaron del panel).
--
--  Idempotente. Correr en: Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

begin;

alter table public.cal_contenido add column if not exists cuerpo text;

comment on column public.cal_contenido.cuerpo is
  'Texto de la ficha, con marcas (**negrita**, [texto](url), "# Título", listas). Nunca HTML.';

update public.cal_contenido
   set cuerpo = nullif(concat_ws(E'\n',
         case when nullif(btrim(copy), '') is not null then E'# Copy\n' || btrim(copy) end,
         case when nullif(btrim(referencias), '') is not null then E'# Referencias\n' || btrim(referencias) end,
         case when nullif(btrim(link), '') is not null then E'# Link\n' || btrim(link) end), '')
 where cuerpo is null
   and (nullif(btrim(copy), '') is not null or nullif(btrim(referencias), '') is not null or nullif(btrim(link), '') is not null);

commit;

-- Verificación: cuántas fichas tienen texto y si quedó alguna con datos
-- viejos sin pasar (tiene que dar 0).
select count(*) filter (where cuerpo is not null) as con_cuerpo,
       count(*) filter (where cuerpo is null and (nullif(btrim(copy), '') is not null
                         or nullif(btrim(referencias), '') is not null or nullif(btrim(link), '') is not null)) as sin_pasar
  from public.cal_contenido;
