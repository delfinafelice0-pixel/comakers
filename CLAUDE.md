# Cómo trabajar en este repo

## Decidí solo, no preguntes

- Nombres de archivos, funciones, columnas y variables.
- Si un cambio va en uno o varios archivos.
- Dónde vive una columna nueva (tabla propia vs existente).
- Forma de la validación local, formato de logs, detalles de reintentos y backoff.
- Sacar código muerto, corregir comentarios desactualizados.
- Commitear una pieza terminada, con mensaje descriptivo.

Si una decisión de estas te parece dudosa, tomá la que te parezca mejor,
hacela, y marcala al final en una línea: "asumí X, decime si no". No frenes.

Juntá las dudas al final del trabajo, no las vayas tirando de a una.

## Frená siempre y preguntá

- Cualquier cosa que borre o pise datos existentes.
- Cambios en autenticación, RLS o permisos.
- Deploys de Edge Functions y ejecución de SQL en Supabase (los corre Delfi,
  tiene los secrets).
- Cualquier cosa que mande algo real a Meta o a un número de WhatsApp real.
- Agregar alcance que no esté en la v1 del CRM.
- Tocar `wa-enviar`: anda, se grabó para la App Review, no se toca sin avisar.

## Contexto

Las migraciones del CRM van con prefijo `migracion-crm-NN` desde 01.
El panel interno usa `migracion-interno-NN` sobre la misma base, desde otro
chat que no ves. Nunca numeres en esa secuencia.

Claves: en el HTML solo publishable key o anon legacy. `sb_secret_` y
`service_role` solo como variables de entorno de las funciones, nunca en
código, nunca en el chat.

Auth del navegador a Edge Functions: apikey = publishable, Authorization =
anon legacy (solo para pasar el gateway), x-user-token = token de sesión
ES256 validado adentro con getUser(). Deploy con `--no-verify-jwt` y
x-user-token en Access-Control-Allow-Headers. No usar functions.invoke.
