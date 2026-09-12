-- ============================================================
--  Sacar clientes.rep_organico / rep_pauta
--  12/09/2026 — cierra el pendiente 5
--
--  Contexto: cliente_modulo es la única verdad desde el 11/09.
--  pull-ads ya la leía. pull-instagram se migró hoy y se verificó
--  con los dos clientes reales (FOS false, Visitando true).
--  Lo único que todavía lee las columnas viejas es el trigger
--  cliente_modulo_por_defecto(), que se reescribe acá.
--
--  CORRER EL BLOQUE 0 PRIMERO. Si devuelve filas inesperadas, parar.
-- ============================================================


-- ───────────────────────────────────────────────────────────────
--  0 ── VERIFICACIÓN PREVIA. No escribe nada.
--
--  0.a — ¿Queda algo en la base leyendo esas columnas?
--        Lo ÚNICO que tiene que aparecer es
--        cliente_modulo_por_defecto. Cualquier otra cosa
--        (una vista, una policy, otra función) es una sorpresa:
--        pará y mirala antes de seguir.
-- ───────────────────────────────────────────────────────────────
select 'funcion' as donde, p.proname as nombre
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname not in ('pg_catalog', 'information_schema')
   and p.prosrc ~* 'rep_organico|rep_pauta'
union all
select 'vista', table_name
  from information_schema.views
 where table_schema = 'public'
   and view_definition ~* 'rep_organico|rep_pauta'
union all
select 'policy: ' || tablename, policyname
  from pg_policies
 where schemaname = 'public'
   and (coalesce(qual, '') ~* 'rep_organico|rep_pauta'
     or coalesce(with_check, '') ~* 'rep_organico|rep_pauta')
union all
select 'columna generada', column_name
  from information_schema.columns
 where table_schema = 'public'
   and coalesce(generation_expression, '') ~* 'rep_organico|rep_pauta';


--  0.b — ¿cliente_modulo dice lo mismo que las columnas viejas?
--        Ya sabemos que FOS difiere en pauta y que cliente_modulo
--        es el que tiene razón. Esto es para ver si rep_organico
--        también se desincronizó en algún cliente.
--        Las filas que salgan NO son un problema: son el registro
--        de qué se pierde al borrar. Miralas y decidí.
select
  c.nombre,
  c.rep_organico,
  (select cm.activo from public.cliente_modulo cm
    where cm.cliente_id = c.id and cm.modulo = 'organico') as modulo_organico,
  c.rep_pauta,
  (select cm.activo from public.cliente_modulo cm
    where cm.cliente_id = c.id and cm.modulo = 'pauta')    as modulo_pauta
from public.clientes c
where coalesce(c.rep_organico, true)
      is distinct from coalesce((select cm.activo from public.cliente_modulo cm
                                  where cm.cliente_id = c.id and cm.modulo = 'organico'), true)
   or coalesce(c.rep_pauta, false)
      is distinct from coalesce((select cm.activo from public.cliente_modulo cm
                                  where cm.cliente_id = c.id and cm.modulo = 'pauta'), false)
order by c.nombre;


--  0.c — ¿Hay algún cliente sin sus dos filas en cliente_modulo?
--        Tiene que dar 0. Si da más, el drop dejaría a ese cliente
--        dependiendo del "sin fila = prendido", que para pauta
--        NO es el default que tenía.
select c.nombre, count(cm.*) as filas
  from public.clientes c
  left join public.cliente_modulo cm on cm.cliente_id = c.id
 group by c.nombre
having count(cm.*) <> 2
 order by c.nombre;



-- ============================================================
--  1 ── LA MIGRACIÓN. Correr solo después de mirar el bloque 0.
-- ============================================================

-- El trigger dejaba nacer a cada cliente nuevo con sus dos filas,
-- leyendo los defaults de las columnas viejas. Ahora los defaults
-- van literales. Son exactamente los mismos valores que producía
-- el coalesce de antes: organico prendido, pauta apagada.
create or replace function public.cliente_modulo_por_defecto()
returns trigger
language plpgsql
as $$
begin
  insert into public.cliente_modulo (cliente_id, modulo, activo)
  values (new.id, 'organico', true),
         (new.id, 'pauta',    false)
  on conflict (cliente_id, modulo) do nothing;
  return new;
end $$;

comment on function public.cliente_modulo_por_defecto() is
  'Cada cliente nuevo nace con sus dos filas en cliente_modulo. '
  'Defaults: organico prendido, pauta apagada. La pauta se prende '
  'desde el chip de administración cuando se carga la cuenta de ads.';

-- El trigger en sí no cambia: apunta a la función por nombre.
-- Se recrea igual por si esta migración corre sobre una base
-- donde no existía.
drop trigger if exists cliente_modulo_por_defecto_trg on public.clientes;
create trigger cliente_modulo_por_defecto_trg
  after insert on public.clientes
  for each row execute function public.cliente_modulo_por_defecto();

-- Y recién ahora las columnas. Sin `cascade` a propósito: si algo
-- depende de ellas que el bloque 0 no encontró, quiero que esto
-- falle ruidosamente en vez de borrar esa cosa en silencio.
alter table public.clientes drop column if exists rep_organico;
alter table public.clientes drop column if exists rep_pauta;



-- ============================================================
--  2 ── CONFIRMACIÓN. Correr después. Tiene que dar 0 filas.
-- ============================================================
select column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'clientes'
   and column_name in ('rep_organico', 'rep_pauta');
