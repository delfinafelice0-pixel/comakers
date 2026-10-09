-- ═══════════════════════════════════════════════════════════════
--  PANEL INTERNO · CoMakers — Parte 46
--  Las consultas de WhatsApp entran al panel.
--
--  ── Qué es esto ─────────────────────────────────────────────
--
--  El módulo CRM: las conversaciones que le llegan por WhatsApp a
--  un cliente nuestro (San Eusebio, pongamos), clasificadas en
--  cuatro estados, y la señal que vuelve a Meta para que la pauta
--  aprenda a quién mostrarle el anuncio.
--
--  El panel NO manda mensajes. El negocio sigue contestando desde
--  su celular (Coexistence) y acá solo leemos los ecos. Eso no es
--  una limitación: es lo que hace que el módulo cueste cero en
--  mensajes. Si algún día aparece una caja de "responder", cada
--  respuesta pasa a costar la tarifa utility del país.
--
--  ── Por qué los datos de acá pesan más ──────────────────────
--
--  Hasta ahora, un agujero de RLS significaba que Marti veía una
--  tarea de más. Desde esta parte significa que alguien lee las
--  conversaciones de WhatsApp de gente que no firmó nada con
--  nosotras: no son nuestros clientes, son los clientes de nuestro
--  cliente. Ley 25.326. Por eso las tres tablas nacen con RLS
--  prendida y con sus policies en la misma migración, no después.
--
--  ── Las tres decisiones que no son obvias ───────────────────
--
--  1. EL ctwa_clid VIVE APARTE, Y NADIE LO LEE.
--     Es el identificador que Meta genera cuando alguien toca un
--     anuncio Click-to-WhatsApp, y es un dato sobre una persona.
--     Podría ser una columna más de `conversacion`, pero entonces
--     viajaría al navegador en cada `select *` y dependería de que
--     ninguna policy futura se equivoque. Así que va en
--     `conversacion_pauta`, con RLS prendida y CERO policies: desde
--     el navegador no se lee ni con rol de agencia. Solo el
--     service_role de las Edge Functions, que salta la RLS.
--
--     El nombre del anuncio y el ad_id sí quedan en `conversacion`:
--     esos no son datos de una persona, son nombres de campaña, y
--     el panel los muestra como chip.
--
--  2. EL PANEL NO DISPARA EL EVENTO A META: LO ENCOLA.
--     Mandar el evento desde `crm.html` con un fetch significaría
--     tener el access token de la cuenta publicitaria del cliente
--     en el navegador. Cualquiera que abra las herramientas de
--     desarrollo podría mandarle Purchase falsos y arruinarle la
--     optimización de la pauta que le cobramos.
--
--     Entonces: el panel solo cambia `estado`. Un disparador anota
--     la fila pendiente en `evento_capi`, y la Edge Function
--     `capi-evento` la levanta y la manda. El token vive del lado
--     del servidor y nunca sale.
--
--  3. EL MÓDULO NACE APAGADO.
--     En la parte 17, `cliente_modulo` se lee al revés: sin fila =
--     prendido. Tiene sentido para lo que ya veían todos. Pero el
--     CRM es un servicio que se cobra aparte, así que se le prende
--     a quien lo paga. Por eso esta migración inserta la fila en
--     false para todos los clientes que existen hoy.
--
--  ── Lo que esta migración NO hace ───────────────────────────
--
--  No toca `crm.html`, que sigue con sus datos inventados. Mientras
--  eso siga así, el archivo no se le muestra a ningún cliente: hoy
--  dice 147 consultas y tres reservas con nombre y apellido que son
--  inventadas. Esa nota va al final de SEGURIDAD-pendientes.md,
--  junto a la de los highlights.
--
--  SIN transacción y SIN rollback. Correr entera.
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────
-- 0 ── Que esté todo lo que las reglas nuevas necesitan
--     Si falta algo, las policies quedarían a medias y la tabla
--     abierta. Mejor que no corra nada.
-- ───────────────────────────────────────────────────────────────
do $$
declare
  v_falta text := '';
begin
  if to_regclass('public.clientes')       is null then v_falta := v_falta || ' clientes';       end if;
  if to_regclass('public.profiles')       is null then v_falta := v_falta || ' profiles';       end if;
  if to_regclass('public.acceso_cliente') is null then v_falta := v_falta || ' acceso_cliente'; end if;
  if to_regclass('public.cliente_modulo') is null then v_falta := v_falta || ' cliente_modulo'; end if;

  if to_regprocedure('public.es_equipo()') is null then
    v_falta := v_falta || ' es_equipo()'; end if;
  if to_regprocedure('public.cliente_de_mi_agencia(uuid)') is null then
    v_falta := v_falta || ' cliente_de_mi_agencia(uuid)'; end if;

  if v_falta <> '' then
    raise exception 'Parte 46: falta%. No corro nada.', v_falta;
  end if;
end $$;


-- ───────────────────────────────────────────────────────────────
-- 1 ── Las conversaciones
--
--     Una fila por persona que le escribió al número del cliente.
--     `telefono` es el wa_id que manda Meta, en dígitos y sin el +.
--
--     El unique (cliente_id, telefono) es lo que hace que el
--     webhook pueda hacer upsert sin pensar: si la persona ya
--     escribió antes, cae en la misma conversación y conserva el
--     estado que le pusieron.
-- ───────────────────────────────────────────────────────────────
create table if not exists public.conversacion (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,

  telefono    text not null,
  nombre      text,

  -- Los cuatro estados del panel. 'sin' es donde nace todo:
  -- una consulta que nadie contestó NO es "no le interesó", y es
  -- la métrica que más le va a doler (y servir) al cliente.
  estado      text not null default 'sin'
              check (estado in ('sin', 'interesado', 'reservo', 'no')),

  -- De dónde vino. 'pauta' es el único que después alimenta a Meta;
  -- los otros dos cuentan para el reporte y nada más.
  origen      text not null default 'directo'
              check (origen in ('pauta', 'instagram', 'directo')),

  -- Nombre y id del anuncio, para el chip de la bandeja y para
  -- cruzar el reporte con la campaña. No son datos de una persona.
  ad_id       text,
  campana     text,

  -- El monto de la reserva. Va en custom_data.value del evento
  -- Purchase: sin esto Meta optimiza por cantidad, con esto
  -- optimiza por plata.
  valor       numeric(14,2),

  nota        text,

  ultimo_en   timestamptz,
  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  unique (cliente_id, telefono)
);

comment on table public.conversacion is
  'Consultas de WhatsApp que le entran a un cliente. Módulo CRM, parte 46.';
comment on column public.conversacion.telefono is
  'wa_id de Meta: solo dígitos, sin +. Dato personal de un tercero.';
comment on column public.conversacion.estado is
  'sin = nadie contestó. Cambiarlo encola el evento a Meta (ver evento_capi).';

create index if not exists conversacion_cliente_idx
  on public.conversacion (cliente_id, ultimo_en desc nulls last);
create index if not exists conversacion_estado_idx
  on public.conversacion (cliente_id, estado);


-- ───────────────────────────────────────────────────────────────
-- 2 ── Los mensajes
--
--     `wa_id` es el id que le pone Meta al mensaje, y es UNIQUE a
--     propósito: los webhooks de Meta se reintentan, y sin esto el
--     mismo mensaje entraría tres veces. El webhook hace
--     `on conflict (wa_id) do nothing` y se olvida del problema.
--
--     `entrante` distingue lo que escribió la persona de lo que
--     contestó el negocio desde su celular, que nos llega como
--     `smb_message_echoes`.
-- ───────────────────────────────────────────────────────────────
create table if not exists public.mensaje (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references public.conversacion(id) on delete cascade,

  wa_id      text unique,
  entrante   boolean not null,
  texto      text,

  enviado_en timestamptz not null,
  creado_en  timestamptz not null default now()
);

comment on table public.mensaje is
  'Mensajes de una conversación. wa_id es unique: los webhooks de Meta se reintentan.';
comment on column public.mensaje.texto is
  'Texto escrito por un desconocido. En el panel va por renderTexto(), NUNCA innerHTML pelado.';

create index if not exists mensaje_conversacion_idx
  on public.mensaje (conversacion_id, enviado_en);


-- ───────────────────────────────────────────────────────────────
-- 3 ── El ctwa_clid, aparte y a oscuras
--
--     RLS prendida y ninguna policy. Eso NO es un olvido: en
--     Postgres, RLS activa sin policies significa que nadie pasa.
--     El service_role de las Edge Functions salta la RLS y es el
--     único que lo lee.
--
--     Sin este identificador, el evento que se le manda a Meta se
--     procesa igual pero no se asocia a ningún anuncio: el
--     algoritmo no aprende y el costo por lead sube sin que nadie
--     se entere. Falla en silencio, que es lo peor.
-- ───────────────────────────────────────────────────────────────
create table if not exists public.conversacion_pauta (
  conversacion_id uuid primary key
                  references public.conversacion(id) on delete cascade,
  ctwa_clid  text not null,
  recibido_en timestamptz not null default now()
);

comment on table public.conversacion_pauta is
  'ctwa_clid de Meta. Dato personal de un tercero. RLS sin policies: solo service_role.';

alter table public.conversacion_pauta enable row level security;
-- (a propósito: cero policies)


-- ───────────────────────────────────────────────────────────────
-- 4 ── La cola de eventos para Meta
--
--     Dos eventos, no uno. `Lead` tiene mucho más volumen que
--     `Purchase` y es lo que le da al algoritmo material para
--     aprender; `Purchase` lleva el monto y es lo que se reporta.
--     La campaña se optimiza por Lead y se mide por Purchase.
--
--     Como `conversacion_pauta`: RLS sin policies. El panel no
--     necesita leer esta tabla y el token tampoco tiene por qué
--     acercarse al navegador.
-- ───────────────────────────────────────────────────────────────
create table if not exists public.evento_capi (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references public.conversacion(id) on delete cascade,

  evento  text not null check (evento in ('Lead', 'Purchase')),
  valor   numeric(14,2),

  estado  text not null default 'pendiente'
          check (estado in ('pendiente', 'ok', 'error')),
  detalle text,
  intentos int not null default 0,

  creado_en  timestamptz not null default now(),
  enviado_en timestamptz
);

comment on table public.evento_capi is
  'Cola de eventos para Conversions API. La llena un trigger, la vacía la Edge Function capi-evento.';

create index if not exists evento_capi_pendientes_idx
  on public.evento_capi (estado, creado_en) where estado <> 'ok';

alter table public.evento_capi enable row level security;
-- (a propósito: cero policies)


-- ───────────────────────────────────────────────────────────────
-- 5 ── El trigger que encola
--
--     Solo encola si la conversación vino de un anuncio Y tiene
--     clid guardado. Sin clid el evento sería ruido: Meta lo
--     aceptaría y no lo asociaría a nada.
--
--     'no' y 'sin' no encolan nada. Se podría mandar un evento
--     negativo, pero Meta optimiza por las señales positivas y
--     mandarle ruido no ayuda: el "malo" es simplemente la
--     ausencia de señal.
-- ───────────────────────────────────────────────────────────────
create or replace function public.encolar_evento_capi()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evento text;
begin
  if new.estado is not distinct from old.estado then
    return new;
  end if;

  v_evento := case new.estado
                when 'reservo'    then 'Purchase'
                when 'interesado' then 'Lead'
                else null
              end;

  if v_evento is null then
    return new;
  end if;

  -- Sin anuncio de origen no hay nada que informarle a Meta.
  if new.origen <> 'pauta'
     or not exists (select 1 from public.conversacion_pauta cp
                     where cp.conversacion_id = new.id) then
    return new;
  end if;

  -- Si ya hay uno pendiente del mismo tipo, no duplicamos: alcanza
  -- con que la Edge Function mande el último estado.
  if exists (select 1 from public.evento_capi e
              where e.conversacion_id = new.id
                and e.evento = v_evento
                and e.estado = 'pendiente') then
    return new;
  end if;

  insert into public.evento_capi (conversacion_id, evento, valor)
  values (new.id, v_evento,
          case when v_evento = 'Purchase' then new.valor else null end);

  return new;
end $$;

drop trigger if exists conversacion_encola_capi on public.conversacion;
create trigger conversacion_encola_capi
  after update of estado on public.conversacion
  for each row execute function public.encolar_evento_capi();


-- Marca de tiempo, como en el resto del panel.
create or replace function public.tocar_conversacion()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists conversacion_tocar on public.conversacion;
create trigger conversacion_tocar
  before update on public.conversacion
  for each row execute function public.tocar_conversacion();


-- ───────────────────────────────────────────────────────────────
-- 6 ── Quién ve qué
--
--     Dos públicos distintos:
--
--     · La agencia ve y escribe lo de SUS clientes. Lo de siempre:
--       es_equipo() + cliente_de_mi_agencia().
--
--     · El cliente (San Eusebio) ve lo suyo, y solo si le prendimos
--       el módulo. Puede cambiar el estado y la nota, porque el CRM
--       es de él y es él quien atiende. No puede tocar el teléfono,
--       el cliente_id ni el valor: eso se restringe abajo con
--       permisos por columna, porque la RLS no distingue columnas.
-- ───────────────────────────────────────────────────────────────
alter table public.conversacion enable row level security;
alter table public.mensaje      enable row level security;

-- Helper: ¿este usuario es un cliente con el módulo CRM prendido?
create or replace function public.cliente_ve_crm(c uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.acceso_cliente a
      join public.cliente_modulo m
        on m.cliente_id = a.cliente_id
       and m.modulo = 'crm'
       and m.activo = true
     where a.cliente_id = c
       and a.user_id = auth.uid()
  );
$$;

comment on function public.cliente_ve_crm(uuid) is
  'El CRM se cobra aparte: a diferencia del resto, sin fila el módulo está APAGADO.';


-- ── conversacion ──
drop policy if exists conversacion_ver on public.conversacion;
create policy conversacion_ver on public.conversacion
  for select to authenticated
  using (
    (public.es_equipo() and public.cliente_de_mi_agencia(cliente_id))
    or public.cliente_ve_crm(cliente_id)
  );

drop policy if exists conversacion_agencia_escribe on public.conversacion;
create policy conversacion_agencia_escribe on public.conversacion
  for all to authenticated
  using      (public.es_equipo() and public.cliente_de_mi_agencia(cliente_id))
  with check (public.es_equipo() and public.cliente_de_mi_agencia(cliente_id));

-- El cliente clasifica lo suyo. El `with check` repite la condición
-- para que no pueda mudar una conversación a otro cliente.
drop policy if exists conversacion_cliente_clasifica on public.conversacion;
create policy conversacion_cliente_clasifica on public.conversacion
  for update to authenticated
  using      (public.cliente_ve_crm(cliente_id))
  with check (public.cliente_ve_crm(cliente_id));

-- ── mensaje ──
--    Cuelga de la conversación: si no se ve la conversación, no se
--    ven sus mensajes. Nadie escribe mensajes desde el navegador,
--    ni la agencia: los pone el webhook con service_role.
drop policy if exists mensaje_ver on public.mensaje;
create policy mensaje_ver on public.mensaje
  for select to authenticated
  using (
    exists (select 1 from public.conversacion c
             where c.id = mensaje.conversacion_id
               and ( (public.es_equipo() and public.cliente_de_mi_agencia(c.cliente_id))
                     or public.cliente_ve_crm(c.cliente_id) ))
  );


-- ───────────────────────────────────────────────────────────────
-- 7 ── Permisos por columna
--
--     La RLS decide QUÉ FILAS. Esto decide QUÉ COLUMNAS, que es lo
--     que la RLS no sabe hacer. Sin esto, el update del cliente le
--     dejaría cambiar su propio `valor` de reserva, y ese número se
--     le manda a Meta como monto de la conversión.
-- ───────────────────────────────────────────────────────────────
revoke all on public.conversacion       from authenticated;
revoke all on public.mensaje            from authenticated;
revoke all on public.conversacion_pauta from authenticated, anon;
revoke all on public.evento_capi        from authenticated, anon;

grant select on public.conversacion to authenticated;
grant select on public.mensaje      to authenticated;

-- Insertar y borrar conversaciones: solo la agencia, y la RLS ya
-- filtra por cliente. (El webhook usa service_role y no pasa por acá.)
grant insert, delete on public.conversacion to authenticated;

-- Lo único que se edita desde el navegador.
grant update (estado, nota, valor) on public.conversacion to authenticated;


-- ───────────────────────────────────────────────────────────────
-- 8 ── El módulo, apagado para todos
--
--     Se prende cliente por cliente cuando lo contratan:
--
--       update cliente_modulo set activo = true
--        where modulo = 'crm' and cliente_id = '<el de San Eusebio>';
-- ───────────────────────────────────────────────────────────────
insert into public.cliente_modulo (cliente_id, modulo, activo)
select c.id, 'crm', false
  from public.clientes c
on conflict (cliente_id, modulo) do nothing;


-- ───────────────────────────────────────────────────────────────
-- 9 ── Retención
--
--     Los mensajes y el clid no se guardan para siempre. No son
--     datos nuestros ni de nuestro cliente: son de gente que no
--     firmó nada con nadie.
--
--     Esto no se agenda acá. Va en el cron de Supabase cuando
--     definamos el plazo, y el plazo va escrito en la política de
--     privacidad antes de que entre el primer mensaje real.
-- ───────────────────────────────────────────────────────────────
create or replace function public.limpiar_crm(meses int default 12)
returns table (mensajes_borrados bigint, clids_borrados bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corte timestamptz := now() - make_interval(months => meses);
  v_msg bigint;
  v_clid bigint;
begin
  if meses < 1 then
    raise exception 'limpiar_crm: el plazo tiene que ser de al menos un mes.';
  end if;

  with b as (delete from public.mensaje m
              where m.enviado_en < v_corte returning 1)
  select count(*) into v_msg from b;

  -- El clid se va antes que la conversación: ya cumplió su función
  -- (el evento se mandó) y es lo más sensible de las tres tablas.
  with b as (delete from public.conversacion_pauta cp
              where cp.recibido_en < v_corte returning 1)
  select count(*) into v_clid from b;

  return query select v_msg, v_clid;
end $$;

revoke all on function public.limpiar_crm(int) from authenticated, anon;

comment on function public.limpiar_crm(int) is
  'Borra mensajes y clids más viejos que N meses. Agendar en cron con el plazo de la política.';


-- ───────────────────────────────────────────────────────────────
-- 10 ── Qué quedó
-- ───────────────────────────────────────────────────────────────
do $$
declare
  v text := '';
begin
  v := v || 'Parte 46 lista.' || chr(10);
  v := v || '  conversacion .......... ' ||
       (select count(*) from public.conversacion)::text || ' filas' || chr(10);
  v := v || '  mensaje ............... ' ||
       (select count(*) from public.mensaje)::text || ' filas' || chr(10);
  v := v || '  modulo crm apagado en . ' ||
       (select count(*) from public.cliente_modulo
         where modulo = 'crm' and activo = false)::text || ' clientes' || chr(10);
  v := v || '  policies .............. ' ||
       (select count(*) from pg_policies
         where schemaname = 'public'
           and tablename in ('conversacion','mensaje'))::text || chr(10);
  v := v || '  sin policies (a propósito): conversacion_pauta, evento_capi';
  raise notice '%', v;
end $$;
