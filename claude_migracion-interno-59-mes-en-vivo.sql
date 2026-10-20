-- ═══════════════════════════════════════════════════════════════
--  Migración 59 · Mes en curso "en vivo" para el cliente
--  18/10/2026 · PROPUESTA, NO CORRIDA. Correr a mano en el SQL Editor.
--
--  Qué hace (solo agrega; no cambia datos de plata ni de configuración):
--   1. reporte_publicado: dos columnas nuevas, `en_vivo` (false por
--      defecto: todo lo publicado hasta hoy queda como estaba) y
--      `datos_al` (de cuándo son los números del snapshot en vivo).
--   2. Un trigger: cuando una PERSONA escribe en reporte_publicado (la
--      agencia publicando desde el panel), la fila queda en_vivo = false.
--      Así publicar con análisis congela el mes aunque la fila antes
--      fuera "en vivo", sin depender de que el panel lo mande.
--   3. cliente_modulo acepta el módulo 'mes_en_vivo' (toggle del ⚙
--      "Mostrar mes en curso"). Sin fila = PRENDIDO.
--   4. public.snapshot_en_vivo(): arma el snapshot SOLO con números y
--      posts (sin ningún texto escrito) del mes en curso y del anterior,
--      para cada cliente con Meta conectado y el toggle prendido. Nunca
--      pisa un mes publicado por la agencia (en_vivo = false). Si el
--      toggle está apagado o el cliente ya no tiene Meta, borra SOLO sus
--      filas en vivo.
--   5. Cron 'snapshot-en-vivo' a las 07:30 UTC (04:30 en Buenos Aires),
--      90 minutos después de 'pull-diario' (06:00 UTC): para entonces los
--      pulls de la noche ya escribieron.
--
--  La regla de la 50B NO cambia: el cliente sigue leyendo solo
--  reporte_publicado. Esto solo agrega filas ahí.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 1 · Columnas nuevas ─────────────────────────────────────────
alter table public.reporte_publicado
  add column if not exists en_vivo  boolean not null default false,
  add column if not exists datos_al timestamptz;

comment on column public.reporte_publicado.en_vivo is
  'true = snapshot automático del mes en curso (solo números y posts, lo arma snapshot_en_vivo() cada noche). false = publicado por la agencia, congelado.';

-- ── 2 · Publicar desde el panel siempre congela ─────────────────
-- auth.uid() es null en el cron (corre como postgres) y tiene valor
-- cuando escribe una persona logueada.
create or replace function public.reporte_publicado_congelar()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if auth.uid() is not null then
    new.en_vivo := false;
    new.datos_al := null;
  end if;
  return new;
end
$$;

drop trigger if exists reporte_publicado_congelar on public.reporte_publicado;
create trigger reporte_publicado_congelar
  before insert or update on public.reporte_publicado
  for each row execute function public.reporte_publicado_congelar();

-- ── 3 · cliente_modulo acepta 'mes_en_vivo' ─────────────────────
-- Mismo patrón que la 51: si hay un CHECK con la lista cerrada, se
-- reemplaza por uno con la lista de la 51 más el módulo nuevo.
do $$
declare r record; habia boolean := false;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'cliente_modulo'
       and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%modulo%'
  loop
    execute format('alter table public.cliente_modulo drop constraint %I', r.conname);
    habia := true;
  end loop;
  if habia then
    execute 'alter table public.cliente_modulo add constraint cliente_modulo_modulo_check check (modulo in ' ||
            '(''organico'',''pauta'',''crm'',''calendario'',''estrategia'',''objetivos'',''one_shot'',''servicio'',''mes_en_vivo'')) not valid';
  end if;
end $$;

-- ── 4 · La función ──────────────────────────────────────────────
create or replace function public.snapshot_en_vivo()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ahora   timestamptz := timezone('America/Argentina/Buenos_Aires', now());
  v_meses   date[];
  v_fuera   text[];
  c         record;
  m         date;
  r         record;
  v_rep     jsonb;
  v_posts   jsonb;
  v_ads     jsonb;
  n_escritos int := 0;
  n_salteados int := 0;
  n_borrados int := 0;
begin
  -- El mes en curso y el anterior (el anterior sigue "en vivo", con los
  -- datos de cierre, hasta que la agencia lo publique).
  v_meses := array[ date_trunc('month', v_ahora)::date,
                    (date_trunc('month', v_ahora) - interval '1 month')::date ];

  -- Columnas de `reporte` que NO van al snapshot en vivo: todo lo que es
  -- texto escrito por la agencia (cualquier columna de texto, salvo los
  -- tres códigos que llena la máquina) y los jsonb con textos adentro.
  -- Se calcula de la tabla: una columna de texto nueva queda afuera sola.
  select array_agg(column_name::text) into v_fuera
    from information_schema.columns
   where table_schema = 'public' and table_name = 'reporte'
     and (
           (data_type in ('text', 'character varying')
              and column_name not in ('moneda_ads', 'accion_ads', 'fuente'))
        or column_name in ('bloques', 'notas_anuncios', 'estado', 'publicado_en',
                           'publicado_por', 'analisis_generado_en')
     );

  -- Limpieza: filas en vivo de clientes con el toggle apagado o sin Meta.
  with fuera as (
    delete from public.reporte_publicado rp
     where rp.en_vivo
       and (
             exists (select 1 from public.cliente_modulo cm
                      where cm.cliente_id = rp.cliente_id
                        and cm.modulo = 'mes_en_vivo' and cm.activo = false)
          or not exists (select 1 from public.cliente_integracion ci
                          where ci.cliente_id = rp.cliente_id and ci.activo
                            and ci.tipo in ('meta_ig', 'meta_ads'))
       )
    returning 1
  )
  select count(*) into n_borrados from fuera;

  for c in
    select distinct ci.cliente_id
      from public.cliente_integracion ci
     where ci.activo and ci.tipo in ('meta_ig', 'meta_ads')
       and not exists (select 1 from public.cliente_modulo cm
                        where cm.cliente_id = ci.cliente_id
                          and cm.modulo = 'mes_en_vivo' and cm.activo = false)
  loop
    foreach m in array v_meses loop
      -- Publicado por la agencia: no se toca.
      if exists (select 1 from public.reporte_publicado rp
                  where rp.cliente_id = c.cliente_id and rp.mes = m and not rp.en_vivo) then
        n_salteados := n_salteados + 1;
        continue;
      end if;

      select * into r from public.reporte
       where cliente_id = c.cliente_id and mes = m;
      -- Sin fila de reporte todavía no hay números (los pulls la crean).
      if not found then continue; end if;
      if r.sincronizado_en is null and r.ads_sincronizado_en is null then continue; end if;

      -- Mismo formato que armarSnapshotMes() del panel, con los textos
      -- vacíos y las métricas manuales afuera: el panel arma las métricas
      -- de Meta desde `cols`, igual que hace con lo vivo.
      v_rep := jsonb_build_object(
        'id', r.id,
        'mes', to_char(m, 'YYYY-MM'),
        'estado', 'publicado',
        'en_vivo', true,
        'resumen', '', 'proximos_pasos', '',
        'analisis', '', 'analisis_organico', '', 'analisis_pauta', '',
        'analisis_generado_en', null,
        'publicado_en', null,
        'fuente', coalesce(r.fuente, 'manual'),
        'sincronizado_en', r.sincronizado_en,
        'ads_sincronizado_en', r.ads_sincronizado_en,
        'cols', to_jsonb(r) - coalesce(v_fuera, array[]::text[]),
        'bloques_extra', '[]'::jsonb,
        'notas_anuncios', '{}'::jsonb,
        'metricas', '[]'::jsonb,
        'destacados', '[]'::jsonb
      );

      -- Posts y anuncios del mes, con las mismas columnas que lee el panel.
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id, 'media_id', p.media_id, 'tipo', p.tipo,
               'publicado_en', p.publicado_en, 'mes', to_char(p.mes, 'YYYY-MM'),
               'caption', p.caption, 'permalink', p.permalink, 'thumb_path', p.thumb_path,
               'views', p.views, 'reach', p.reach, 'likes', p.likes, 'comments', p.comments,
               'saves', p.saves, 'shares', p.shares, 'interacciones', p.interacciones)
             order by p.media_id), '[]'::jsonb)
        into v_posts
        from public.post_instagram p
       where p.cliente_id = c.cliente_id and p.mes = m;

      select coalesce(jsonb_agg(jsonb_build_object(
               'id', a.id, 'ad_id', a.ad_id, 'mes', to_char(a.mes, 'YYYY-MM'),
               'nombre', a.nombre, 'campania', a.campania, 'conjunto', a.conjunto,
               'estado', a.estado, 'permalink', a.permalink, 'thumb_path', a.thumb_path,
               'inversion', a.inversion, 'moneda', a.moneda, 'resultados', a.resultados,
               'accion', a.accion, 'costo_resultado', a.costo_resultado, 'reach', a.reach,
               'impresiones', a.impresiones, 'frecuencia', a.frecuencia, 'clics', a.clics,
               'ctr', a.ctr, 'cpm', a.cpm)
             order by a.ad_id), '[]'::jsonb)
        into v_ads
        from public.anuncio_meta a
       where a.cliente_id = c.cliente_id and a.mes = m;

      insert into public.reporte_publicado
             (cliente_id, mes, snapshot, publicado_en, publicado_por, en_vivo, datos_al)
      values (c.cliente_id, m,
              jsonb_build_object('v', 1, 'mes', to_char(m, 'YYYY-MM'), 'en_vivo', true,
                                 'reporte', v_rep, 'posts', v_posts, 'anuncios', v_ads),
              now(), 'En vivo (automático)', true,
              greatest(r.sincronizado_en, r.ads_sincronizado_en))
      on conflict (cliente_id, mes) do update
         set snapshot = excluded.snapshot,
             publicado_en = excluded.publicado_en,
             publicado_por = excluded.publicado_por,
             datos_al = excluded.datos_al
       -- Doble seguro: si entre el chequeo y acá la agencia publicó, no se pisa.
       where public.reporte_publicado.en_vivo;

      n_escritos := n_escritos + 1;
    end loop;
  end loop;

  return jsonb_build_object('escritos', n_escritos, 'salteados_publicados', n_salteados,
                            'borrados', n_borrados, 'meses', v_meses, 'cuando', now());
end
$$;

revoke all on function public.snapshot_en_vivo() from public, anon, authenticated;

-- ── 5 · El cron ─────────────────────────────────────────────────
do $$
begin
  perform cron.unschedule('snapshot-en-vivo');
exception when others then null;
end $$;
select cron.schedule('snapshot-en-vivo', '30 7 * * *', 'select public.snapshot_en_vivo();');

commit;

-- ── Para probar después de correrla (solo lectura salvo la 1ª) ──
-- select public.snapshot_en_vivo();   -- arma los en vivo ya, sin esperar la noche
-- select c.nombre, rp.mes, rp.en_vivo, rp.datos_al, rp.publicado_por
--   from public.reporte_publicado rp join public.clientes c on c.id = rp.cliente_id
--  order by c.nombre, rp.mes desc;
