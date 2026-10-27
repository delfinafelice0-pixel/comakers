-- ═══════════════════════════════════════════════════════════════
--  Migración 60 · Montos de servicios: solo socias y el cliente
--  27/10/2026 · PROPUESTA, NO CORRIDA. Correr a mano en el SQL Editor.
--  Toca PERMISOS (no datos): una función y políticas de RLS.
--
--  Regla:
--   · Socias (rol 'socia') y super admin: ven todo, como hoy.
--   · El cliente: ve el monto pactado de su servicio (si está publicado),
--     como hoy.
--   · Equipo (agencia, no socia): la base NO le manda ningún monto: ni
--     el precio de referencia del catálogo, ni el costo de los
--     entregables, ni el monto pactado, ni el historial de ajustes, ni
--     el % propuesto de ajuste.
--
--  Por dónde le llegaban hoy al equipo (lo demás ya era solo socias):
--   1. panel_servicio(): es SECURITY DEFINER y trataba a todo el que es
--      "agencia" igual. → ahora, para el equipo, monto / tipo / historial
--      / ajuste_pct vuelven en null y avisa `ve_montos: false`.
--   2. contrato_ajuste (historial con montos): su política dejaba leer y
--      escribir a toda la agencia. → ahora solo socias / super.
--   3. servicio (precio), servicio_item, entregable (cuesta) y contrato
--      (monto): las políticas que están en la base no viven en el repo.
--      Se normalizan: se borra toda política de esas tablas que no pida
--      es_socia() / es_super() (se listan con NOTICE al correr) y queda
--      una sola, solo socias / super. Si ya estaban bien, no cambia nada.
--
--  No cambia: la regla de la 50B, lo que ve el cliente, ni nada de lo
--  que ve una socia. Los triggers y crons que tocan contrato corren con
--  permisos propios (SECURITY DEFINER / postgres) y no dependen de RLS.
-- ═══════════════════════════════════════════════════════════════

-- ── 0 · ANTES DE CORRER (solo lectura): qué políticas hay hoy ───
-- select tablename, policyname, cmd, qual, with_check
--   from pg_policies
--  where schemaname = 'public'
--    and tablename in ('servicio', 'servicio_item', 'entregable', 'contrato', 'contrato_ajuste')
--  order by tablename, policyname;

begin;

-- ── 1 · Quién ve montos ─────────────────────────────────────────
create or replace function public.ve_montos()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.es_super(), false) or coalesce(public.es_socia(), false);
$$;
revoke all on function public.ve_montos() from public, anon;
grant execute on function public.ve_montos() to authenticated;

-- ── 2 · panel_servicio: el equipo recibe todo menos los montos ──
create or replace function public.panel_servicio(p_cliente uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ag  boolean := public.panel_es_agencia_de(p_cliente);
  cl  boolean := public.panel_es_cliente_de(p_cliente);
  -- Montos: socias/super siempre; el cliente según lo publicado; el
  -- equipo nunca (aunque además tuviera acceso como cliente).
  sm  boolean := public.ve_montos();
  eq  boolean;
  pub public.servicio_publicacion;
  v_inc boolean; v_mon boolean; v_his boolean; v_prox boolean;
begin
  if not ag and not cl then return null; end if;
  eq := ag and not sm;
  select * into pub from public.servicio_publicacion where cliente_id = p_cliente;
  v_inc  := ag or coalesce(pub.incluye, false);
  v_mon  := not eq and (ag or coalesce(pub.monto, false));
  v_his  := not eq and (ag or coalesce(pub.historial, false));
  v_prox := ag or coalesce(pub.proximo_ajuste, false);

  return jsonb_build_object(
    'agencia', ag,
    've_montos', not eq,
    'publicacion', case when ag then jsonb_build_object(
        'incluye', coalesce(pub.incluye, false), 'monto', coalesce(pub.monto, false),
        'historial', coalesce(pub.historial, false), 'proximo_ajuste', coalesce(pub.proximo_ajuste, false)) end,
    'incluye_texto', case when v_inc then pub.incluye_texto end,
    'contratos', case when not (v_inc or v_mon or v_his or v_prox) then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id,
        'nombre', k.nombre,
        'detalle', case when v_inc then k.detalle end,
        'plan', case when v_inc then (select s.nombre from public.servicio s where s.id = k.servicio_id) end,
        'items', case when v_inc then coalesce((
            select jsonb_agg(jsonb_build_object('nombre', e.nombre, 'cantidad', si.cantidad, 'unidad', e.unidad)
                             order by si.orden)
              from public.servicio_item si join public.entregable e on e.id = si.entregable_id
             where si.servicio_id = k.servicio_id), '[]'::jsonb) end,
        'monto', case when v_mon then k.monto end,
        'tipo', case when v_mon then k.tipo end,
        'ultimo_ajuste', case when v_his or v_prox then k.ultimo_ajuste end,
        'proximo_ajuste', case when v_prox then k.proximo_ajuste end,
        'ajuste_pct', case when ag and not eq then k.ajuste_pct end,
        'historial', case when v_his then coalesce((
            select jsonb_agg(jsonb_build_object('id', a.id, 'fecha', a.fecha, 'anterior', a.monto_anterior,
                                                'nuevo', a.monto_nuevo, 'pct', a.pct, 'nota', a.nota)
                             order by a.fecha desc, a.creado_en desc)
              from public.contrato_ajuste a where a.contrato_id = k.id), '[]'::jsonb) end
      ) order by k.nombre)
      from public.contrato k
     where k.cliente_id = p_cliente and coalesce(k.activo, true)), '[]'::jsonb) end
  );
end $$;
revoke all on function public.panel_servicio(uuid) from public, anon;
grant execute on function public.panel_servicio(uuid) to authenticated;

-- ── 3 · contrato_ajuste: solo socias / super ────────────────────
drop policy if exists contrato_ajuste_agencia on public.contrato_ajuste;
create policy contrato_ajuste_agencia on public.contrato_ajuste for all to authenticated
  using      (public.panel_es_agencia_de(cliente_id) and public.ve_montos())
  with check (public.panel_es_agencia_de(cliente_id) and public.ve_montos());

-- ── 4 · servicio, servicio_item, entregable, contrato ───────────
do $$
declare t text; p record;
begin
  foreach t in array array['servicio', 'servicio_item', 'entregable', 'contrato'] loop
    if to_regclass('public.' || t) is null then
      raise notice '% no existe: se saltea', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    for p in
      select policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
        from pg_policies where schemaname = 'public' and tablename = t
    loop
      if p.expr !~ 'es_socia' and p.expr !~ 've_montos' then
        raise notice 'Se borra la política % de % (no pedía socia): %', p.policyname, t, p.expr;
        execute format('drop policy %I on public.%I', p.policyname, t);
      end if;
    end loop;
    execute format('drop policy if exists %I on public.%I', t || '_socias', t);
    execute format('create policy %I on public.%I for all to authenticated ' ||
                   'using (public.ve_montos()) with check (public.ve_montos())', t || '_socias', t);
  end loop;
end $$;

commit;

-- ── 5 · DESPUÉS (solo lectura): cómo quedó ──────────────────────
-- select tablename, policyname, cmd, qual
--   from pg_policies
--  where schemaname = 'public'
--    and tablename in ('servicio', 'servicio_item', 'entregable', 'contrato', 'contrato_ajuste')
--  order by tablename, policyname;
