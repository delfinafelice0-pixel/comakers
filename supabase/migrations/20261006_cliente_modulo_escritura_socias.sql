-- ═══════════════════════════════════════════════════════════════
--  cliente_modulo: escritura solo para socias/super
--  06/10/2026
--
--  Contexto: hoy cliente_modulo lo puede ESCRIBIR cualquier perfil
--  con tipo='agencia' activo (policy `cliente_modulo_agencia`, ALL).
--  cliente_integracion en cambio solo lo escriben es_super() o
--  es_socia() (policy `cliente_integracion_escribe`, ALL). Las dos
--  tablas son la misma configuración del panel y las va a tocar el
--  mismo popup de administración, así que las igualamos: la ESCRITURA
--  de cliente_modulo pasa a ser es_super() OR es_socia(), idéntica a
--  cliente_integracion.
--
--  La LECTURA no se toca: `cliente_modulo_ver` (SELECT) sigue dejando
--  que el cliente lea sus propios módulos (vía acceso_cliente) y que
--  cualquier perfil de agencia los lea. El panel de cliente depende de
--  esa lectura; esta migración no la roza.
--
--  Idempotente: dropea la policy vieja y la nueva por nombre antes de
--  crear, así se puede correr más de una vez sin romper.
-- ═══════════════════════════════════════════════════════════════

-- Todo el cambio de policies va en una transacción: o quedan las dos
-- (drop de la vieja + create de la nueva) o no queda ninguna. Sin esto,
-- un error entre el drop y el create dejaría la tabla sin policy de
-- escritura y nadie podría tocar los módulos.
begin;

-- La policy de escritura vieja (predicado profiles.tipo='agencia').
drop policy if exists cliente_modulo_agencia  on public.cliente_modulo;
-- Por si esta migración ya corrió antes.
drop policy if exists cliente_modulo_escribe  on public.cliente_modulo;

create policy cliente_modulo_escribe on public.cliente_modulo
  for all
  to authenticated
  using      ( public.es_super() or public.es_socia() )
  with check ( public.es_super() or public.es_socia() );

commit;

-- ───────────────────────────────────────────────────────────────
--  Confirmación: cliente_modulo y cliente_integracion tienen que
--  quedar con el MISMO predicado de escritura. Las dos filas de
--  escritura (cmd = ALL) deben decir "(es_super() OR es_socia())".
--  La fila de lectura de cliente_modulo queda como estaba.
-- ───────────────────────────────────────────────────────────────
select
  c.relname as tabla,
  p.polname as policy,
  case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                when 'w' then 'UPDATE' when 'd' then 'DELETE'
                when '*' then 'ALL' end as cmd,
  pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_policy  p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname in ('cliente_modulo', 'cliente_integracion')
order by tabla, cmd;
