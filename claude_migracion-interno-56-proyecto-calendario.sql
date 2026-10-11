-- ═══════════════════════════════════════════════════════════════
--  migracion-interno-56 · proyecto para las tareas del Calendario
--  11/10/2026
--
--  Cada cliente puede tener un proyecto de /interno donde caen las
--  tareas de edición y subida que crea el Calendario del panel
--  (clientes.proyecto_calendario_id). Se elige en Administración →
--  Clientes → ⚙. Sin proyecto elegido, las tareas quedan sueltas en el
--  tablero general, como hasta ahora.
--
--  Valor por defecto: si el cliente tiene UN SOLO proyecto activo (no
--  archivado ni finalizado), queda ese. Es lo que dejaba "un proyecto por
--  cliente" (la 39, que no está en el repo). Si tiene varios o ninguno, no
--  se toca: se elige a mano.
--
--  Si se borra el proyecto, el campo vuelve a vacío (on delete set null).
--
--  Idempotente. Correr en: Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

begin;

alter table public.clientes
  add column if not exists proyecto_calendario_id uuid references public.proyecto(id) on delete set null;

comment on column public.clientes.proyecto_calendario_id is
  'Proyecto de /interno donde el Calendario del panel crea las tareas de edición y subida. Null = sueltas.';

update public.clientes c
   set proyecto_calendario_id = u.proyecto_id
  from (select p.cliente_id, min(p.id::text)::uuid as proyecto_id
          from public.proyecto p
         where p.cliente_id is not null
           and not coalesce(p.archivado, false)
           and p.finalizado_en is null
         group by p.cliente_id
        having count(*) = 1) u
 where u.cliente_id = c.id
   and c.proyecto_calendario_id is null;

commit;

-- Verificación: qué cliente quedó con qué proyecto, y cuáles tienen
-- varios proyectos (esos se eligen a mano en Administración).
select c.nombre as cliente, p.nombre as proyecto_calendario,
       (select count(*) from public.proyecto x where x.cliente_id = c.id
          and not coalesce(x.archivado, false) and x.finalizado_en is null) as proyectos_activos
  from public.clientes c
  left join public.proyecto p on p.id = c.proyecto_calendario_id
 where c.activo is not false
 order by (p.id is null), c.nombre;
