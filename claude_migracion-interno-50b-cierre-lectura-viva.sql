-- ═══════════════════════════════════════════════════════════════
--  migracion-interno-50B · el cliente ya no lee lo vivo del reporte
--  13/10/2026
--
--  FASE B del snapshot (la A es 50a-reporte-publicado). Desde acá, el
--  cliente ve SOLO lo que la agencia publicó (reporte_publicado): ni el
--  reporte vivo, ni sus métricas, ni destacados, ni posts, ni anuncios.
--  La agencia sigue viendo todo igual.
--
--  ⚠️ CORRER SOLO CUANDO NO QUEDEN REPORTES PUBLICADOS SIN SNAPSHOT
--  (botón "Generar snapshots de lo publicado" en el panel). Si queda
--  alguno, esta migración NO hace nada: corta con un error que dice
--  cuántos faltan. Así ningún cliente se queda sin ver un reporte.
--
--  Cómo: no se borra ninguna policy existente (sus nombres no están en
--  el repo y borrar a ciegas es peor). Se agrega en cada tabla una
--  policy RESTRICTIVA de lectura: Postgres exige que se cumpla ADEMÁS
--  de las que ya hay, y esta solo la cumple la agencia
--  (panel_es_agencia_de, de la 51, incluye super). El cliente queda
--  afuera sin tocar nada más.
--
--  No cambia datos. Idempotente. Para deshacer: los drop policy del
--  final (comentados).
--  Correr en: Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 0 · Freno: ¿quedan publicados sin snapshot? ─────────────────
do $$
declare faltan int; cuales text;
begin
  select count(*), string_agg(c.nombre || ' ' || to_char(r.mes, 'MM/YY'), ', ')
    into faltan, cuales
    from public.reporte r
    join public.clientes c on c.id = r.cliente_id
   where r.estado = 'publicado'
     and not exists (select 1 from public.reporte_publicado s
                      where s.cliente_id = r.cliente_id and s.mes = r.mes);
  if faltan > 0 then
    raise exception 'No se aplicó la 50B: quedan % reporte(s) publicado(s) sin snapshot (%). Generalos con el botón del panel y volvé a correrla.', faltan, cuales;
  end if;
end $$;

-- ── 1 · Lo vivo, solo para la agencia ───────────────────────────
drop policy if exists reporte_lectura_solo_agencia on public.reporte;
create policy reporte_lectura_solo_agencia on public.reporte
  as restrictive for select to authenticated
  using (public.panel_es_agencia_de(cliente_id));

drop policy if exists reporte_metrica_lectura_solo_agencia on public.reporte_metrica;
create policy reporte_metrica_lectura_solo_agencia on public.reporte_metrica
  as restrictive for select to authenticated
  using (exists (select 1 from public.reporte r
                  where r.id = reporte_metrica.reporte_id and public.panel_es_agencia_de(r.cliente_id)));

drop policy if exists reporte_destacado_lectura_solo_agencia on public.reporte_destacado;
create policy reporte_destacado_lectura_solo_agencia on public.reporte_destacado
  as restrictive for select to authenticated
  using (exists (select 1 from public.reporte r
                  where r.id = reporte_destacado.reporte_id and public.panel_es_agencia_de(r.cliente_id)));

drop policy if exists post_instagram_lectura_solo_agencia on public.post_instagram;
create policy post_instagram_lectura_solo_agencia on public.post_instagram
  as restrictive for select to authenticated
  using (public.panel_es_agencia_de(cliente_id));

drop policy if exists anuncio_meta_lectura_solo_agencia on public.anuncio_meta;
create policy anuncio_meta_lectura_solo_agencia on public.anuncio_meta
  as restrictive for select to authenticated
  using (public.panel_es_agencia_de(cliente_id));

commit;

-- ── Verificación ────────────────────────────────────────────────
-- Las cinco restrictivas tienen que aparecer (permissive = RESTRICTIVE).
select tablename, policyname, permissive, cmd
  from pg_policies
 where schemaname = 'public' and policyname like '%_lectura_solo_agencia'
 order by tablename;

-- ── Para deshacer (si hiciera falta) ────────────────────────────
-- drop policy reporte_lectura_solo_agencia on public.reporte;
-- drop policy reporte_metrica_lectura_solo_agencia on public.reporte_metrica;
-- drop policy reporte_destacado_lectura_solo_agencia on public.reporte_destacado;
-- drop policy post_instagram_lectura_solo_agencia on public.post_instagram;
-- drop policy anuncio_meta_lectura_solo_agencia on public.anuncio_meta;
