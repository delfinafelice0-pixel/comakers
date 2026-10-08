-- ═══════════════════════════════════════════════════════════════
--  migracion-interno-49 · Entregables: limpieza de precargados
--  07/10/2026
--
--  La lista de entregables la arma la agencia. Los precargados (los que
--  nacieron con sistema = true: Reel, Story, Carrusel, etc.) salen de
--  circulación:
--     · los que NUNCA se usaron en un plan  → se borran de verdad.
--     · los que YA se usaron en algún plan   → se archivan (activo=false):
--       dejan de ofrecerse, pero los planes que los nombran quedan intactos.
--
--  El ÚNICO FK a entregable es servicio_item.entregable_id (verificado el
--  07/10 con information_schema). No hay link con Distribución: los
--  trabajos viven en `movimiento` y no referencian entregable. Por eso
--  "en uso" = aparece en servicio_item.
--
--  Permisos: ya están. La policy `entregable_socias` es ALL con es_socia(),
--  así que cubre DELETE. No hace falta migración de permisos.
--
--  Correr en: Supabase → SQL Editor. BLOQUE 0 primero (read-only).
-- ═══════════════════════════════════════════════════════════════

-- ── BLOQUE 0 · PREVIEW (no toca nada) ───────────────────────────
-- Corré esto PRIMERO: dice qué precargados hay, en cuántos planes está
-- cada uno, y qué le va a pasar. Esto es el "decime cuáles están en uso".
select
  e.id, e.nombre, e.unidad, e.cuesta, e.activo,
  count(si.*)                        as filas_en_servicio_item,
  count(distinct si.servicio_id)     as en_planes,
  case when count(si.*) > 0 then 'se ARCHIVA' else 'se BORRA' end as accion
from public.entregable e
left join public.servicio_item si on si.entregable_id = e.id
where e.sistema is true
group by e.id, e.nombre, e.unidad, e.cuesta, e.activo
order by accion, e.nombre;


-- ── BLOQUE 1 · CLEANUP ──────────────────────────────────────────
-- Corré esto cuando el preview te cierre. Atómico.
begin;

-- Precargados EN USO: se archivan (el historial de los planes queda).
update public.entregable e
   set activo = false
 where e.sistema is true
   and exists (select 1 from public.servicio_item si where si.entregable_id = e.id);

-- Precargados SIN USO: se borran de verdad.
delete from public.entregable e
 where e.sistema is true
   and not exists (select 1 from public.servicio_item si where si.entregable_id = e.id);

commit;


-- ── Verificación ────────────────────────────────────────────────
-- No tiene que quedar ningún precargado ACTIVO (todos borrados o
-- archivados). Los que queden son archivados (activo = false) porque
-- están en algún plan.
select
  count(*) filter (where activo is not false) as precargados_activos,
  count(*)                                     as precargados_que_quedan
from public.entregable where sistema is true;
-- Esperado: precargados_activos = 0.
