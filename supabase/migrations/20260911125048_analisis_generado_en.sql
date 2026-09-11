-- Marca de borrador para `analisis`.
--
-- Sin esto no hay forma de distinguir un texto que escribió Claude de
-- uno que revisó una persona: `analisis` es un text y los dos casos se
-- ven igual.
--
-- Convención:
--   analisis_generado_en con fecha  → borrador sin revisar
--   analisis_generado_en null       → lo escribió o lo revisó una persona
--
-- Aditiva: no toca datos existentes. Las filas de hoy quedan en null,
-- que es lo correcto — todo lo que hay ahora lo escribió alguien a mano.
alter table public.reporte
  add column if not exists analisis_generado_en timestamptz;

comment on column public.reporte.analisis_generado_en is
  'Si tiene fecha, `analisis` es un borrador generado y sin revisar. Se pone en null cuando una persona lo edita y guarda.';
