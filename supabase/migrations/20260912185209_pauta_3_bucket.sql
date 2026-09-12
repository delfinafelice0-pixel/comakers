-- ═══════════════════════════════════════════════════════════════
--  Bucket post-thumbs · dos agujeros de visibilidad
--
--  Los dos se encontraron auditando, no porque algo fallara: quien
--  probaba era super_admin y entraba por la primera rama de la
--  policy. Ninguno es una fuga — son lo contrario, gente que NO iba
--  a ver lo que le corresponde.
--
--  1. LAS MINIATURAS DE ANUNCIOS NO LAS IBA A VER NADIE MÁS QUE EL
--     SUPER. La policy compara el primer nivel de carpeta contra el
--     cliente_id:
--         (storage.foldername(name))[1] = ac.cliente_id
--     Los posts van a `{cliente_id}/{media_id}.jpg` y matchean. Pero
--     los anuncios se guardaron en `ads/{cliente_id}/{ad_id}.jpg`, y
--     ahí el primer nivel es el literal "ads", que nunca va a ser un
--     UUID. Un cliente vería el bloque "En qué se invirtió" con
--     "sin imagen" en todas las tarjetas.
--
--     Se arregla del lado de la RUTA, no de la policy: los anuncios
--     pasan a `{cliente_id}/ads/{ad_id}.jpg`. Así queda una sola
--     regla para todo el bucket en vez de una policy que entienda
--     dos formatos distintos.
--
--  2. FALTABA LA RAMA DE AGENCIA. La policy solo miraba super_admin
--     o acceso_cliente. Es exactamente el caso de la parte 28
--     ("acceso_cliente era una pared entre nosotras"): alguien de la
--     agencia que no esté asignada a ese cliente tampoco veía las
--     imágenes, sin ningún error que lo dijera.
--
--  ⚠️ DESPUÉS DE ESTA MIGRACIÓN hay que redesplegar pull-ads con la
--     ruta nueva, y volver a correrlo para los meses que ya estaban.
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
--  1 ── Los archivos viejos NO se borran acá
--
--  Supabase bloquea el DELETE directo sobre storage.objects:
--    "Direct deletion from storage tables is not allowed.
--     Use the Storage API instead." (42501)
--  Tiene sentido: la fila y el archivo en disco son dos cosas, y
--  borrar solo la fila dejaría el archivo huérfano ocupando espacio.
--
--  Los 5 objetos que quedan bajo `ads/` se borran aparte, con la
--  Storage API. No molestan: el pull los vuelve a bajar en la ruta
--  nueva y los viejos simplemente dejan de referenciarse.
-- ───────────────────────────────────────────────────────────────


-- ───────────────────────────────────────────────────────────────
--  2 ── La policy, con la rama de agencia
--
--  Se reescribe, no se agrega otra: las policies permisivas se suman
--  con OR y dejar la vieja al lado no arreglaría nada.
-- ───────────────────────────────────────────────────────────────
drop policy if exists "post_thumbs_lectura" on storage.objects;

create policy "post_thumbs_lectura" on storage.objects
  for select
  using (
    bucket_id = 'post-thumbs'
    and (
      -- El super ve todo.
      exists (select 1 from public.profiles p
               where p.id = auth.uid() and p.super_admin = true)
      -- La agencia ve lo de los clientes que atiende. Sin esto,
      -- quien no esté en acceso_cliente no ve las imágenes aunque
      -- sea de la agencia — el problema de la parte 28.
      or (public.es_agencia()
          and public.cliente_de_mi_agencia(
                ((storage.foldername(objects.name))[1])::uuid))
      -- Y el cliente, lo suyo. El primer nivel de carpeta es su
      -- cliente_id, tanto para posts como para anuncios.
      or exists (select 1 from public.acceso_cliente ac
                  where ac.user_id = auth.uid()
                    and (ac.cliente_id)::text = (storage.foldername(objects.name))[1])
    )
  );


-- ───────────────────────────────────────────────────────────────
--  3 ── Confirmación
-- ───────────────────────────────────────────────────────────────
select
  (select count(*) from pg_policy pol
     join pg_class c on c.oid = pol.polrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
      and pol.polname = 'post_thumbs_lectura')            as policy_puesta,
  (select count(*) from storage.objects
    where bucket_id = 'post-thumbs'
      and (storage.foldername(name))[1] = 'ads')          as huerfanos_por_borrar;
