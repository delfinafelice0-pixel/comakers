-- ═══════════════════════════════════════════════════════════════
--  migracion-interno-54 · ejecutoras: se heredan del contrato y son
--  SOLO socias
--  09/10/2026 · ampliada el 10/10/2026 (regla "solo socias")
--
--  1. Todo cobro nuevo hereda las ejecutoras de su contrato (trigger
--     AFTER INSERT en cobro). Cubre generar_cobros y cualquier otro
--     camino. Solo copia socias, aunque el contrato tenga a otra persona.
--
--  2. La base IMPIDE que una no-socia sea ejecutora: un trigger en
--     contrato_ejecutora y cobro_ejecutora rechaza el INSERT/UPDATE si
--     el user_id no es socia (profiles.rol = 'socia'). Las colaboradoras
--     (Gina, Ludmila, Karin, Paula) cobran por Trabajos, nunca como
--     ejecutoras. Es trigger y no CHECK porque un CHECK no puede mirar
--     otra tabla (profiles).
--
--  NO toca lo que ya existe: las no-socias que ya estén cargadas se
--  sacan con limpiar-ejecutoras-no-socias.sql, y los cobros sin nadie se
--  completan con completar-ejecutoras.sql (los dos se pasan sin correr).
--
--  Idempotente: si ya corriste la versión del 09/10, correla de nuevo.
--  Correr en: Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ¿Este usuario es socia? (security definer: no depende de la RLS de
-- profiles de quien inserta.)
create or replace function public.es_socia_id(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_user and p.rol = 'socia')
$$;
revoke all on function public.es_socia_id(uuid) from public, anon;
grant execute on function public.es_socia_id(uuid) to authenticated;

-- ── 1 · Herencia contrato → cobro (solo socias) ─────────────────
create or replace function public.cobro_hereda_ejecutoras()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.cobro_ejecutora (cobro_id, user_id)
  select new.id, ce.user_id
    from public.contrato_ejecutora ce
   where ce.contrato_id = new.contrato_id
     and public.es_socia_id(ce.user_id)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists cobro_hereda_ejecutoras_trg on public.cobro;
create trigger cobro_hereda_ejecutoras_trg
  after insert on public.cobro
  for each row when (new.contrato_id is not null)
  execute function public.cobro_hereda_ejecutoras();

-- ── 2 · Guarda: ejecutora = socia, desde donde sea ──────────────
create or replace function public.ejecutora_solo_socias()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.es_socia_id(new.user_id) then
    raise exception 'Solo las socias pueden ser ejecutoras (% no es socia). Las colaboradoras cobran por Trabajos.',
      coalesce((select nombre from public.profiles where id = new.user_id), new.user_id::text)
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists contrato_ejecutora_solo_socias_trg on public.contrato_ejecutora;
create trigger contrato_ejecutora_solo_socias_trg
  before insert or update of user_id on public.contrato_ejecutora
  for each row execute function public.ejecutora_solo_socias();

drop trigger if exists cobro_ejecutora_solo_socias_trg on public.cobro_ejecutora;
create trigger cobro_ejecutora_solo_socias_trg
  before insert or update of user_id on public.cobro_ejecutora
  for each row execute function public.ejecutora_solo_socias();

commit;

-- Verificación: los tres triggers existen.
select tgname, tgrelid::regclass as tabla
  from pg_trigger
 where tgname in ('cobro_hereda_ejecutoras_trg', 'contrato_ejecutora_solo_socias_trg', 'cobro_ejecutora_solo_socias_trg')
 order by 1;
