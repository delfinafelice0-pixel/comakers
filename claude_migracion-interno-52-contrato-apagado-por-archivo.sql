-- ═══════════════════════════════════════════════════════════════
--  migracion-interno-52 · contrato.apagado_por_archivo
--  08/10/2026
--
--  El interruptor "Cliente activo" (administración, commit 0afaf9b)
--  apaga los contratos del cliente al archivarlo. Al reactivarlo tienen
--  que volver SOLO los que apagó el interruptor, no los que ya estaban
--  archivados de antes (p. ej. los históricos que creó el import del
--  Sheet con activo = false).
--
--  Esta columna guarda eso: true = "lo apagó el archivado del cliente".
--  Al reactivar, el panel prende solo esos y la vuelve a false.
--
--  Idempotente. Correr en: Supabase → SQL Editor. No cambia ningún dato:
--  los clientes ya archivados se acomodan aparte (ver el chequeo del 08/10).
-- ═══════════════════════════════════════════════════════════════

alter table public.contrato
  add column if not exists apagado_por_archivo boolean not null default false;

comment on column public.contrato.apagado_por_archivo is
  'true = lo apagó el interruptor "Cliente activo" al archivar el cliente. Al reactivarlo vuelven solo estos.';

-- Verificación: la columna existe y nadie la tiene en true todavía.
select count(*) as contratos, count(*) filter (where apagado_por_archivo) as marcados
  from public.contrato;
