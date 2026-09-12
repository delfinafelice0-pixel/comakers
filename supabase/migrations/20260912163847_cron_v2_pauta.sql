-- ═══════════════════════════════════════════════════════════════
--  sync_diario · v2: suma la pauta y respeta los módulos
--
--  Qué cambia respecto de la v1:
--
--  1. Dispara pull-ads además de los dos de Instagram.
--
--  2. Recorre CLIENTES, no integraciones. Antes el bucle iba sobre
--     `cliente_integracion` filtrando tipo='meta_ig', así que un
--     cliente con pauta y sin Instagram nunca entraba.
--
--  3. Mira `cliente_modulo` antes de disparar. Un cliente sin pauta
--     contratada no recibe llamadas a la API de ads, y uno sin
--     orgánico no recibe las de Instagram. pull-ads ya se protege
--     solo, pero es mejor no disparar que disparar y descartar.
--
--  Lo de siempre: el log del cron va a decir timeout y no es un
--  error. El registro que vale es cliente_integracion.ultimo_sync.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.sync_diario()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url    text;
  v_key    text;
  v_ahora  timestamptz := timezone('America/Argentina/Buenos_Aires', now());
  v_meses  text[];
  c        record;
  m        text;
  f        text;
  fns      text[];
  n        int := 0;
  n_org    int := 0;
  n_ads    int := 0;
  clientes int := 0;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';

  if v_url is null or v_key is null then
    raise exception 'Faltan project_url y/o service_role_key en Vault.';
  end if;

  -- El mes en curso, siempre. Y los primeros días del mes también el
  -- anterior: si no, el último día de cada mes nunca se sincroniza.
  v_meses := array[ to_char(v_ahora, 'YYYY-MM') ];
  if extract(day from v_ahora) <= 3 then
    v_meses := v_meses || to_char(v_ahora - interval '1 month', 'YYYY-MM');
  end if;

  -- Un cliente entra si tiene alguna integración activa. Qué se le
  -- dispara depende de qué módulo tiene prendido y de qué cuenta
  -- tiene conectada: las dos condiciones, no una.
  --
  -- Sin fila en cliente_modulo se asume prendido, que es el contrato
  -- que ya venía usando el panel.
  for c in
    select
      cl.id as cliente_id,
      coalesce(bool_or(ci.tipo = 'meta_ig'  and ci.activo), false) as tiene_ig,
      coalesce(bool_or(ci.tipo = 'meta_ads' and ci.activo), false) as tiene_ads,
      coalesce((select cm.activo from public.cliente_modulo cm
                 where cm.cliente_id = cl.id and cm.modulo = 'organico'), true) as quiere_org,
      coalesce((select cm.activo from public.cliente_modulo cm
                 where cm.cliente_id = cl.id and cm.modulo = 'pauta'), true)    as quiere_ads
    from public.clientes cl
    join public.cliente_integracion ci on ci.cliente_id = cl.id and ci.activo
    group by cl.id
  loop
    fns := array[]::text[];
    if c.tiene_ig  and c.quiere_org then fns := fns || array['pull-instagram', 'pull-posts']; end if;
    if c.tiene_ads and c.quiere_ads then fns := fns || array['pull-ads']; end if;
    if array_length(fns, 1) is null then continue; end if;

    clientes := clientes + 1;

    foreach m in array v_meses loop
      foreach f in array fns loop
        -- Un disparo independiente por cliente, mes y función. Cada
        -- uno arranca con sus propios 150s de límite.
        perform net.http_post(
          url     := v_url || '/functions/v1/' || f,
          headers := jsonb_build_object(
                       'Content-Type', 'application/json',
                       'Authorization', 'Bearer ' || v_key),
          body    := jsonb_build_object('cliente_id', c.cliente_id, 'mes', m),
          timeout_milliseconds := 120000
        );
        n := n + 1;
        if f = 'pull-ads' then n_ads := n_ads + 1; else n_org := n_org + 1; end if;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object(
    'disparos', n, 'instagram', n_org, 'ads', n_ads,
    'clientes', clientes, 'meses', v_meses, 'cuando', now());
end $$;

comment on function public.sync_diario() is
  'La dispara el cron pull-diario. Lanza los pulls de Meta según qué módulos tenga prendidos cada cliente. No espera respuesta: el resultado real queda en cliente_integracion.ultimo_sync / ultimo_error.';

revoke all on function public.sync_diario() from public;
revoke all on function public.sync_diario() from anon, authenticated;

-- Confirmación: qué se va a disparar esta noche, sin disparar nada.
select
  cl.nombre,
  coalesce(bool_or(ci.tipo = 'meta_ig'  and ci.activo), false) as tiene_ig,
  coalesce(bool_or(ci.tipo = 'meta_ads' and ci.activo), false) as tiene_ads,
  coalesce((select cm.activo from public.cliente_modulo cm
             where cm.cliente_id = cl.id and cm.modulo = 'organico'), true) as quiere_org,
  coalesce((select cm.activo from public.cliente_modulo cm
             where cm.cliente_id = cl.id and cm.modulo = 'pauta'), true)    as quiere_ads
from public.clientes cl
join public.cliente_integracion ci on ci.cliente_id = cl.id and ci.activo
group by cl.id, cl.nombre
order by cl.nombre;
