-- ═══════════════════════════════════════════════════════════════
--  migracion-interno-54 · todo cobro nuevo hereda las ejecutoras de su
--  contrato
--  09/10/2026
--
--  Los cobros que crea la app (generar_cobros) nacían sin nadie en
--  cobro_ejecutora, aunque el contrato tuviera ejecutoras en Clientes:
--  en Distribución salían "sin asignar" y el 85% no se repartía.
--
--  Un trigger AFTER INSERT en cobro copia contrato_ejecutora →
--  cobro_ejecutora. Va en la base (y no en el panel) porque los cobros
--  los crea una función de la base: así cubre generar_cobros y cualquier
--  otro camino. Quien quiera otras ejecutoras para un cobro puntual las
--  cambia después, como siempre (el import del Sheet, por ejemplo,
--  reemplaza las heredadas por las de la planilla).
--
--  NO toca los cobros que ya existen: eso va aparte, en el SQL de
--  completar (se pasa sin correr).
--
--  Idempotente. Correr en: Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.cobro_hereda_ejecutoras()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.cobro_ejecutora (cobro_id, user_id)
  select new.id, ce.user_id
    from public.contrato_ejecutora ce
   where ce.contrato_id = new.contrato_id
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists cobro_hereda_ejecutoras_trg on public.cobro;
create trigger cobro_hereda_ejecutoras_trg
  after insert on public.cobro
  for each row when (new.contrato_id is not null)
  execute function public.cobro_hereda_ejecutoras();

-- Verificación: el trigger existe.
select tgname, tgenabled from pg_trigger where tgname = 'cobro_hereda_ejecutoras_trg';
