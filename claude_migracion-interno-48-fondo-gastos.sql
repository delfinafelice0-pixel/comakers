-- ═══════════════════════════════════════════════════════════════
--  migracion-interno-48 · Fondo + Gastos
--  07/10/2026
--
--  Dos tablas para la solapa "Fondo + Gastos" de administración:
--
--    gasto          — cada gasto del fondo (fecha, descripción,
--                     categoría, monto, comprobante/nota, pagado por).
--    fondo_inicial  — UNA fila con el saldo inicial del fondo y el mes
--                     desde el que se empieza a acumular. Se carga una
--                     sola vez; de ahí en más el fondo de cada mes se
--                     calcula solo (10% de la distribución menos gastos).
--
--  Permisos: SOLO socias y super admin ven y editan (es_super() OR
--  es_socia()), igual que el resto de la plata (reparto, socia_reparto).
--
--  Todo en una transacción. Idempotente (if not exists / drop policy if
--  exists). Correr en: Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

begin;

create table if not exists public.gasto (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null default current_date,
  descripcion text,
  categoria   text,
  monto       numeric not null default 0,
  comprobante text,
  pagado_por  uuid references public.profiles(id) on delete set null,
  creado_en   timestamptz not null default now(),
  creado_por  uuid default auth.uid()
);

-- Una sola fila: el id es un boolean fijo en true, así que un segundo
-- insert choca contra la PK y nunca hay dos saldos iniciales.
create table if not exists public.fondo_inicial (
  id             boolean primary key default true check (id),
  saldo          numeric not null default 0,
  desde          date not null default date_trunc('month', current_date)::date,
  actualizado_en timestamptz not null default now()
);

alter table public.gasto         enable row level security;
alter table public.fondo_inicial enable row level security;

drop policy if exists gasto_socias on public.gasto;
create policy gasto_socias on public.gasto
  for all to authenticated
  using      ( public.es_super() or public.es_socia() )
  with check ( public.es_super() or public.es_socia() );

drop policy if exists fondo_inicial_socias on public.fondo_inicial;
create policy fondo_inicial_socias on public.fondo_inicial
  for all to authenticated
  using      ( public.es_super() or public.es_socia() )
  with check ( public.es_super() or public.es_socia() );

commit;

-- ── Verificación ────────────────────────────────────────────────
-- Las dos tablas tienen que aparecer con rls_on = true y una policy
-- ALL cuyo predicado sea (es_super() OR es_socia()).
select
  c.relname as tabla,
  c.relrowsecurity as rls_on,
  p.polname as policy,
  case p.polcmd when '*' then 'ALL' else p.polcmd::text end as cmd,
  pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relname in ('gasto', 'fondo_inicial')
order by tabla;
