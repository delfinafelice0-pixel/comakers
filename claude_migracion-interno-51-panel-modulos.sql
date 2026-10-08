-- ═══════════════════════════════════════════════════════════════
--  migracion-interno-51 · panel del cliente: Calendario, Estrategia,
--  Servicio, Objetivos y One Shot
--  08/10/2026
--
--  (El 50B queda reservado para la segunda fase del snapshot.)
--
--  Reglas que valen para TODAS las tablas de acá:
--
--    1. Todo cuelga de `cliente_id`. Nada de proyecto.
--    2. El cliente no ve NADA que la agencia no haya publicado, y no hay
--       herencia: cada fila tiene su propio `publicado`. Publicar un
--       documento no publica sus secciones, y viceversa (una sección
--       publicada de un documento oculto tampoco se ve).
--    3. Comentarios por canal separado (`interno` / `cliente`), con
--       `interno` por defecto. El cliente solo lee y escribe `cliente`.
--
--  Patrón de RLS (igual que reporte_publicado / post_instagram):
--    · agencia: ALL sobre los clientes de SU agencia (o super).
--    · cliente: SELECT de lo publicado, vía acceso_cliente.
--  Dos excepciones, explícitas:
--    · cal_evento: el cliente carga, edita y borra SUS actividades
--      comerciales (tipo = 'comercial', cargado_por_cliente = true).
--    · aprobación del cliente de un contenido: por RPC
--      (panel_aprobar_contenido), no por UPDATE directo, para que no
--      pueda tocar ninguna otra columna.
--  El Servicio NO abre `contrato` al cliente: lo lee por RPC
--  (panel_servicio), que devuelve solo las partes publicadas.
--
--  Idempotente. Correr en: Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 0 · Helpers ─────────────────────────────────────────────────
-- security definer: así las policies no dependen de que el usuario
-- pueda leer acceso_cliente / profiles por su cuenta.
create or replace function public.panel_es_agencia_de(p_cliente uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_super() or (public.es_agencia() and public.cliente_de_mi_agencia(p_cliente))
$$;

create or replace function public.panel_es_cliente_de(p_cliente uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.acceso_cliente a
                  where a.cliente_id = p_cliente and a.user_id = auth.uid())
$$;

revoke all on function public.panel_es_agencia_de(uuid) from public, anon;
revoke all on function public.panel_es_cliente_de(uuid) from public, anon;
grant execute on function public.panel_es_agencia_de(uuid) to authenticated;
grant execute on function public.panel_es_cliente_de(uuid) to authenticated;


-- ── 1 · cliente_modulo acepta los módulos nuevos ────────────────
-- Si la columna `modulo` tiene un CHECK con la lista cerrada, se
-- reemplaza por uno que suma los cinco nuevos. `not valid`: no vuelve
-- a revisar filas viejas (si hubiera algún valor raro, no frena esto).
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
            '(''organico'',''pauta'',''crm'',''calendario'',''estrategia'',''objetivos'',''one_shot'',''servicio'')) not valid';
  end if;
end $$;
-- Sin filas nuevas en cliente_modulo: los cinco módulos nacen APAGADOS
-- (el panel los trata como apagados si no hay fila).


-- ── 2 · Calendario ──────────────────────────────────────────────

-- Categorías de contenido con su color. cliente_id null = de la
-- agencia, valen para todos. Con cliente_id = propias de ese cliente.
create table if not exists public.cal_categoria (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete cascade,
  nombre     text not null,
  color      text not null default '#cfd8dc',
  orden      double precision not null default 0,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

-- Una publicación (o idea, si `fecha` es null: el backlog).
create table if not exists public.cal_contenido (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references public.clientes(id) on delete cascade,
  fecha            date,                       -- null = idea sin fecha (backlog)
  hora             text,
  categoria_id     uuid references public.cal_categoria(id) on delete set null,
  titulo           text not null,
  responsable_id   uuid,
  responsable      text,                       -- el nombre, para que el cliente lo vea sin leer profiles
  formato          text,
  copy             text,
  referencias      text,
  link             text,
  aprob_agencia    boolean not null default false,
  aprob_cliente    boolean not null default false,
  aprob_cliente_en timestamptz,
  publicado        boolean not null default false,
  tarea_edicion_id uuid,
  tarea_subida_id  uuid,
  orden            double precision not null default 0,
  creado_por       uuid default auth.uid(),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);
create index if not exists cal_contenido_cliente_fecha_idx on public.cal_contenido (cliente_id, fecha);

-- Lo que no es publicación: recurrentes ("Pilates 09:00" mar y jue),
-- ausencias de varios días ("viaje Maca"), actividades comerciales
-- (lanzamientos, promos; las puede cargar el cliente) y fechas
-- especiales propias (las de Argentina vienen precargadas en el panel).
create table if not exists public.cal_evento (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references public.clientes(id) on delete cascade,
  tipo                text not null check (tipo in ('recurrente', 'ausencia', 'comercial', 'especial')),
  titulo              text not null,
  detalle             text,
  desde               date not null,
  hasta               date,                    -- ausencia/comercial: último día; recurrente: hasta cuándo (null = sin fin)
  dias_semana         smallint[],              -- recurrente: 1 = lunes … 7 = domingo
  hora                text,
  color               text,
  publicado           boolean not null default false,
  cargado_por_cliente boolean not null default false,
  creado_por          uuid default auth.uid(),
  creado_en           timestamptz not null default now()
);
create index if not exists cal_evento_cliente_idx on public.cal_evento (cliente_id, desde);

-- El bloque fijo (Drive + instrucciones) y si el cliente ve las
-- fechas especiales precargadas. Cada cosa con su propia publicación.
create table if not exists public.cal_config (
  cliente_id                uuid primary key references public.clientes(id) on delete cascade,
  drive_link                text,
  instrucciones             text,
  publicado                 boolean not null default false,
  mostrar_fechas_especiales boolean not null default false,
  actualizado_en            timestamptz not null default now()
);

-- Comentarios de cualquier cosa del panel (hoy: contenidos del
-- calendario). `entidad` dice de qué tabla es `entidad_id`.
create table if not exists public.panel_comentario (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references public.clientes(id) on delete cascade,
  entidad      text not null,
  entidad_id   uuid not null,
  canal        text not null default 'interno' check (canal in ('interno', 'cliente')),
  texto        text not null,
  autor_id     uuid default auth.uid(),
  autor_nombre text,
  es_cliente   boolean not null default false,
  creado_en    timestamptz not null default now()
);
create index if not exists panel_comentario_entidad_idx on public.panel_comentario (entidad, entidad_id);


-- ── 3 · Estrategia ──────────────────────────────────────────────
-- Bloques de texto o tabla, en dos partes separadas: orgánico y pauta.
-- `tabla` = {"columnas": [...], "filas": [[...], ...]}.
create table if not exists public.estrategia_bloque (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  parte          text not null check (parte in ('organico', 'pauta')),
  clave          text,
  titulo         text not null,
  tipo           text not null default 'texto' check (tipo in ('texto', 'tabla')),
  texto          text,
  tabla          jsonb,
  orden          double precision not null default 0,
  publicado      boolean not null default false,
  actualizado_en timestamptz not null default now()
);
create index if not exists estrategia_bloque_cliente_idx on public.estrategia_bloque (cliente_id, parte, orden);


-- ── 4 · Servicio ────────────────────────────────────────────────
-- Historial de montos: lo llena solo un trigger cada vez que cambia
-- contrato.monto (incluye el "Ajustar" de administración). Los
-- ajustes de antes de hoy se cargan a mano desde el panel.
create table if not exists public.contrato_ajuste (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  contrato_id    uuid not null references public.contrato(id) on delete cascade,
  fecha          date not null default current_date,
  monto_anterior numeric,
  monto_nuevo    numeric not null,
  pct            numeric,
  nota           text,
  creado_en      timestamptz not null default now()
);
create index if not exists contrato_ajuste_contrato_idx on public.contrato_ajuste (contrato_id, fecha);

create or replace function public.contrato_registrar_ajuste()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.monto is distinct from old.monto and new.monto is not null then
    insert into public.contrato_ajuste (cliente_id, contrato_id, fecha, monto_anterior, monto_nuevo, pct)
    values (new.cliente_id, new.id, current_date, old.monto, new.monto,
            case when coalesce(old.monto, 0) > 0
                 then round((new.monto::numeric - old.monto::numeric) / old.monto::numeric * 100, 1) end);
  end if;
  return new;
end $$;

drop trigger if exists contrato_registrar_ajuste_trg on public.contrato;
create trigger contrato_registrar_ajuste_trg
  after update of monto on public.contrato
  for each row execute function public.contrato_registrar_ajuste();

-- Qué partes del servicio ve el cliente. Cada una por separado.
create table if not exists public.servicio_publicacion (
  cliente_id     uuid primary key references public.clientes(id) on delete cascade,
  incluye        boolean not null default false,
  monto          boolean not null default false,
  historial      boolean not null default false,
  proximo_ajuste boolean not null default false,
  incluye_texto  text,                         -- entregables escritos a mano (uno por línea), si el contrato no tiene plan
  actualizado_en timestamptz not null default now()
);


-- ── 5 · Objetivos ───────────────────────────────────────────────
-- cualitativo: avance a mano (0-100). medible: atado a una métrica del
-- reporte; el avance se calcula en el panel con los números del mes.
--   modo 'pct'   → meta = +10 (%) sobre la base
--   modo 'abs'   → meta = +500 sobre la base
--   modo 'valor' → meta = llegar a 2000
create table if not exists public.objetivo (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  tipo           text not null default 'cualitativo' check (tipo in ('cualitativo', 'medible')),
  titulo         text not null,
  descripcion    text,
  metrica        text,                         -- clave del reporte: seguidores_total, alcance, resultados…
  modo           text check (modo in ('pct', 'abs', 'valor')),
  meta           numeric,
  base_mes       date,
  base_valor     numeric,                      -- si es null se toma del reporte de base_mes
  desde          date,
  hasta          date,
  estado         text not null default 'en_curso' check (estado in ('en_curso', 'logrado', 'no_logrado', 'pausado')),
  avance_manual  smallint check (avance_manual between 0 and 100),
  nota_avance    text,
  orden          double precision not null default 0,
  publicado      boolean not null default false,
  creado_en      timestamptz not null default now()
);
create index if not exists objetivo_cliente_idx on public.objetivo (cliente_id, orden);


-- ── 6 · One Shot ────────────────────────────────────────────────
-- El diagnóstico inicial y las auditorías (cada 6 meses) son
-- documentos; las secciones son filas para poder publicarlas una por
-- una y comparar el mismo `area` entre versiones.
create table if not exists public.oneshot_doc (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  tipo       text not null default 'diagnostico' check (tipo in ('diagnostico', 'auditoria')),
  titulo     text not null,
  fecha      date not null default current_date,
  resumen    text,
  publicado  boolean not null default false,
  creado_en  timestamptz not null default now()
);

create table if not exists public.oneshot_seccion (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.clientes(id) on delete cascade,
  doc_id        uuid not null references public.oneshot_doc(id) on delete cascade,
  area          text not null,
  puntaje       smallint check (puntaje between 1 and 5),
  texto         text,
  recomendacion text,
  orden         double precision not null default 0,
  publicado     boolean not null default false
);
create index if not exists oneshot_seccion_doc_idx on public.oneshot_seccion (doc_id, orden);


-- ── 7 · RLS ─────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['cal_categoria','cal_contenido','cal_evento','cal_config','panel_comentario',
                           'estrategia_bloque','contrato_ajuste','servicio_publicacion','objetivo',
                           'oneshot_doc','oneshot_seccion']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Agencia: todo sobre los clientes de su agencia. (cal_categoria va
-- aparte por las globales.)
do $$
declare t text;
begin
  foreach t in array array['cal_contenido','cal_evento','cal_config','panel_comentario',
                           'estrategia_bloque','contrato_ajuste','servicio_publicacion','objetivo',
                           'oneshot_doc','oneshot_seccion']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_agencia', t);
    execute format('create policy %I on public.%I for all to authenticated ' ||
                   'using (public.panel_es_agencia_de(cliente_id)) with check (public.panel_es_agencia_de(cliente_id))',
                   t || '_agencia', t);
  end loop;
end $$;

-- Cliente: lee lo publicado. Sin herencia en ningún sentido.
do $$
declare t text;
begin
  foreach t in array array['cal_contenido','cal_config','estrategia_bloque','objetivo','oneshot_doc']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_cliente_lee', t);
    execute format('create policy %I on public.%I for select to authenticated ' ||
                   'using (publicado and public.panel_es_cliente_de(cliente_id))',
                   t || '_cliente_lee', t);
  end loop;
end $$;

-- Sección del One Shot: publicada ELLA y su documento.
drop policy if exists oneshot_seccion_cliente_lee on public.oneshot_seccion;
create policy oneshot_seccion_cliente_lee on public.oneshot_seccion for select to authenticated
  using (publicado and public.panel_es_cliente_de(cliente_id)
         and exists (select 1 from public.oneshot_doc d where d.id = oneshot_seccion.doc_id and d.publicado));

-- Eventos: lo publicado + lo que cargó el propio cliente.
drop policy if exists cal_evento_cliente_lee on public.cal_evento;
create policy cal_evento_cliente_lee on public.cal_evento for select to authenticated
  using ((publicado or cargado_por_cliente) and public.panel_es_cliente_de(cliente_id));

drop policy if exists cal_evento_cliente_carga on public.cal_evento;
create policy cal_evento_cliente_carga on public.cal_evento for insert to authenticated
  with check (tipo = 'comercial' and cargado_por_cliente and public.panel_es_cliente_de(cliente_id));

drop policy if exists cal_evento_cliente_edita on public.cal_evento;
create policy cal_evento_cliente_edita on public.cal_evento for update to authenticated
  using      (tipo = 'comercial' and cargado_por_cliente and public.panel_es_cliente_de(cliente_id))
  with check (tipo = 'comercial' and cargado_por_cliente and public.panel_es_cliente_de(cliente_id));

drop policy if exists cal_evento_cliente_borra on public.cal_evento;
create policy cal_evento_cliente_borra on public.cal_evento for delete to authenticated
  using (tipo = 'comercial' and cargado_por_cliente and public.panel_es_cliente_de(cliente_id));

-- Comentarios: el cliente lee y escribe SOLO el canal cliente.
drop policy if exists panel_comentario_cliente_lee on public.panel_comentario;
create policy panel_comentario_cliente_lee on public.panel_comentario for select to authenticated
  using (canal = 'cliente' and public.panel_es_cliente_de(cliente_id));

drop policy if exists panel_comentario_cliente_escribe on public.panel_comentario;
create policy panel_comentario_cliente_escribe on public.panel_comentario for insert to authenticated
  with check (canal = 'cliente' and es_cliente and autor_id = auth.uid()
              and public.panel_es_cliente_de(cliente_id));

-- Categorías: las globales las lee cualquiera logueado (son nombres y
-- colores) y las escribe la agencia; las de un cliente, como el resto.
drop policy if exists cal_categoria_lee on public.cal_categoria;
create policy cal_categoria_lee on public.cal_categoria for select to authenticated
  using (cliente_id is null or public.panel_es_agencia_de(cliente_id) or public.panel_es_cliente_de(cliente_id));

drop policy if exists cal_categoria_agencia on public.cal_categoria;
create policy cal_categoria_agencia on public.cal_categoria for all to authenticated
  using      (case when cliente_id is null then public.es_super() or public.es_agencia()
                   else public.panel_es_agencia_de(cliente_id) end)
  with check (case when cliente_id is null then public.es_super() or public.es_agencia()
                   else public.panel_es_agencia_de(cliente_id) end);


-- ── 8 · RPC ─────────────────────────────────────────────────────

-- El cliente aprueba (o des-aprueba) un contenido publicado. Solo toca
-- aprob_cliente; por UPDATE directo podría tocar cualquier columna.
create or replace function public.panel_aprobar_contenido(p_id uuid, p_ok boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_cliente uuid;
begin
  select cliente_id into v_cliente from public.cal_contenido where id = p_id and publicado;
  if v_cliente is null then return false; end if;
  if not (public.panel_es_cliente_de(v_cliente) or public.panel_es_agencia_de(v_cliente)) then return false; end if;
  update public.cal_contenido
     set aprob_cliente = p_ok, aprob_cliente_en = case when p_ok then now() end
   where id = p_id;
  return true;
end $$;

-- El Servicio de un cliente. A la agencia le devuelve todo y qué está
-- publicado; al cliente, SOLO las partes publicadas (el resto ni viaja).
create or replace function public.panel_servicio(p_cliente uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ag  boolean := public.panel_es_agencia_de(p_cliente);
  cl  boolean := public.panel_es_cliente_de(p_cliente);
  pub public.servicio_publicacion;
  v_inc boolean; v_mon boolean; v_his boolean; v_prox boolean;
begin
  if not ag and not cl then return null; end if;
  select * into pub from public.servicio_publicacion where cliente_id = p_cliente;
  v_inc  := ag or coalesce(pub.incluye, false);
  v_mon  := ag or coalesce(pub.monto, false);
  v_his  := ag or coalesce(pub.historial, false);
  v_prox := ag or coalesce(pub.proximo_ajuste, false);

  return jsonb_build_object(
    'agencia', ag,
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
        'ajuste_pct', case when ag then k.ajuste_pct end,
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

revoke all on function public.panel_aprobar_contenido(uuid, boolean) from public, anon;
revoke all on function public.panel_servicio(uuid) from public, anon;
grant execute on function public.panel_aprobar_contenido(uuid, boolean) to authenticated;
grant execute on function public.panel_servicio(uuid) to authenticated;


-- ── 9 · Categorías de la agencia (precargadas) ──────────────────
-- ids fijos para que los datos de demo puedan apuntarles.
insert into public.cal_categoria (id, cliente_id, nombre, color, orden) values
  (md5('cal_categoria:educativo')::uuid,     null, 'Educativo',     '#a9cce3', 1),
  (md5('cal_categoria:entretenido')::uuid,   null, 'Entretenido',   '#f9d77e', 2),
  (md5('cal_categoria:venta')::uuid,         null, 'Venta',         '#f1a99b', 3),
  (md5('cal_categoria:institucional')::uuid, null, 'Institucional', '#c9bfe6', 4),
  (md5('cal_categoria:testimonio')::uuid,    null, 'Testimonio',    '#a8dcb5', 5),
  (md5('cal_categoria:comunidad')::uuid,     null, 'Comunidad',     '#f5bfd6', 6)
on conflict (id) do nothing;

commit;

-- ── Verificación ────────────────────────────────────────────────
-- Las 11 tablas con RLS prendida y sus policies. Ninguna policy de
-- cliente tiene que ser ALL.
select c.relname as tabla, c.relrowsecurity as rls_on, p.polname as policy,
  case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
       when 'w' then 'UPDATE' when 'd' then 'DELETE' when '*' then 'ALL' end as cmd
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname in ('cal_categoria','cal_contenido','cal_evento','cal_config','panel_comentario',
                    'estrategia_bloque','contrato_ajuste','servicio_publicacion','objetivo',
                    'oneshot_doc','oneshot_seccion')
order by tabla, cmd, policy;
