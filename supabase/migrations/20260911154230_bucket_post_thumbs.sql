-- ═══════════════════════════════════════════════════════════════
--  Bucket de miniaturas
--
--  Las URLs de media que devuelve Meta son firmadas y vencen en
--  horas. Por eso el pull baja cada imagen y la sube acá: cualquier
--  esquema de "guardo la URL y bajo la imagen cuando alguien la
--  mire" queda roto al día siguiente.
--
--  Privado, no público. Un bucket público rompería la promesa de
--  "el cliente ve lo suyo": las miniaturas quedarían legibles por
--  cualquiera que adivine la ruta. El panel firma las URLs al
--  renderizar, en lote.
-- ═══════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('post-thumbs', 'post-thumbs', false)
on conflict (id) do nothing;

-- ── Lectura ───────────────────────────────────────────────────
-- La ruta es {cliente_id}/{media_id}.jpg, así que el primer segmento
-- del path dice de qué cliente es. Mismo patrón de acceso que la
-- tabla post.
drop policy if exists "post_thumbs_lectura" on storage.objects;

create policy "post_thumbs_lectura" on storage.objects
  for select
  using (
    bucket_id = 'post-thumbs'
    and (
      exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.super_admin = true)
      or exists (select 1 from public.acceso_cliente ac
                 where ac.user_id = auth.uid()
                   and ac.cliente_id::text = (storage.foldername(name))[1])
    )
  );

-- ── Escritura ─────────────────────────────────────────────────
-- No se crea ninguna política de insert/update/delete a propósito:
-- el único que sube es la edge function, que usa service role y
-- pasa por encima de RLS. Sin política, nadie más puede escribir
-- desde el navegador aunque tenga sesión.
