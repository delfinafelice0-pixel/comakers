-- ═══════════════════════════════════════════════════════════════
--  Migración 61 · "Control de tareas" (grilla por cliente)
--  27/10/2026 · PROPUESTA, NO CORRIDA. Correr a mano en el SQL Editor.
--
--  Solo AGREGA dos tablas nuevas; no toca nada existente.
--   · control_columna: las columnas que define la agencia (nombre, tipo,
--     orden). Una lista por agencia (clientes.agencia / profiles.agencia).
--   · control_celda: el valor de cada (cliente, columna). Un campo por
--     tipo, así cambiar el tipo de una columna no pisa lo cargado.
--  Permisos: solo la agencia (socias y equipo) y super admin. El cliente
--  no tiene ninguna política: no lee ni escribe nada.
--  Arranca con tres columnas para CoMakers: "Calendario revisado"
--  (casilla), "Ir a grabar" (casilla) y "Grabado hasta" (fecha).
-- ═══════════════════════════════════════════════════════════════

begin;

create table if not exists public.control_columna (
  id         uuid primary key default gen_random_uuid(),
  agencia    text not null,
  nombre     text not null check (length(trim(nombre)) > 0),
  tipo       text not null check (tipo in ('texto', 'fecha', 'casilla')),
  orden      int  not null default 0,
  creado_en  timestamptz not null default now()
);
create index if not exists control_columna_agencia_orden on public.control_columna (agencia, orden);

create table if not exists public.control_celda (
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  columna_id     uuid not null references public.control_columna(id) on delete cascade,
  valor_texto    text,
  valor_fecha    date,
  valor_casilla  boolean,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid default auth.uid(),
  primary key (cliente_id, columna_id)
);

-- La agencia de quien está logueada (texto, igual que clientes.agencia).
create or replace function public.control_mi_agencia()
returns text language sql stable security definer set search_path = public as $$
  select p.agencia from public.profiles p where p.id = auth.uid();
$$;
revoke all on function public.control_mi_agencia() from public, anon;
grant execute on function public.control_mi_agencia() to authenticated;

alter table public.control_columna enable row level security;
alter table public.control_celda   enable row level security;
revoke all on public.control_columna from anon;
revoke all on public.control_celda   from anon;
grant select, insert, update, delete on public.control_columna to authenticated;
grant select, insert, update, delete on public.control_celda   to authenticated;

drop policy if exists control_columna_agencia on public.control_columna;
create policy control_columna_agencia on public.control_columna for all to authenticated
  using      (public.es_super() or (public.es_agencia() and agencia = public.control_mi_agencia()))
  with check (public.es_super() or (public.es_agencia() and agencia = public.control_mi_agencia()));

drop policy if exists control_celda_agencia on public.control_celda;
create policy control_celda_agencia on public.control_celda for all to authenticated
  using      (public.es_super() or (public.es_agencia() and public.cliente_de_mi_agencia(cliente_id)))
  with check (public.es_super() or (public.es_agencia() and public.cliente_de_mi_agencia(cliente_id)));

-- Las tres columnas de arranque (solo si CoMakers todavía no tiene ninguna).
insert into public.control_columna (agencia, nombre, tipo, orden)
select 'CoMakers', x.nombre, x.tipo, x.orden
  from (values ('Calendario revisado', 'casilla', 1),
               ('Ir a grabar',         'casilla', 2),
               ('Grabado hasta',       'fecha',   3)) as x(nombre, tipo, orden)
 where not exists (select 1 from public.control_columna where agencia = 'CoMakers');

commit;

-- Para revisar después (solo lectura):
-- select agencia, orden, nombre, tipo from public.control_columna order by agencia, orden;
-- select distinct agencia from public.profiles where tipo = 'agencia';   -- tiene que decir CoMakers
-- Quién de la agencia va a ver las columnas (ve_columnas = true para todas):
-- select p.nombre, p.agencia,
--        exists (select 1 from public.control_columna c where c.agencia = p.agencia) as ve_columnas
--   from public.profiles p
--  where p.tipo = 'agencia'
--  order by p.nombre;
