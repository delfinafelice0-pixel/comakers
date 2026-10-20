# Spec — Puente Zernio (CRM WhatsApp, v1)

> Diseño para que Claude Code lo implemente contra el repo real de CoMakers.
> **Vos diseñás, él implementa.** Este doc es el contrato; no inventar fuera de acá.

## Contexto en una línea
Anuncios Meta → WhatsApp (vía Zernio) traen consultas con `ctwa_clid`. Guardamos el contacto, el equipo de CoMakers clasifica a mano (lead / venta), y mandamos el evento a Meta por Zernio para que la pauta optimice contra resultados reales. Lo usa el equipo, no el cliente final.

## Principios de diseño (no negociables)
1. **Aislado.** Todo con prefijo `zernio_` (tablas, functions) y `puente.html` propio. Cero dependencia de las tablas/cron del camino Meta. **No tocar `evento_capi` ni su cron.** Baja de Zernio = borrar tablas `zernio_*`, functions `zernio-*` y `puente.html`, sin desenredar nada.
2. **La API key de Zernio vive solo en Edge Functions** (secret de Supabase). Nunca en el browser / GitHub Pages.
3. **Envío de conversión sincrónico al clasificar.** Sin cola, sin pg_cron. (Al no encolar en `evento_capi`, el cron de Meta no tiene filas del puente para levantar.)
4. **Scope v1, nada más:** recibir conversaciones de anuncios → guardar contacto + clid → marcar lead/venta a mano → mandar evento a Meta. Sin bots, sin métricas, sin inbox/respuestas, sin asignar entre personas.

## Stack (espejar el camino Meta)
- Postgres + Edge Functions en Deno, deploy con Supabase CLI.
- Front: `puente.html` estático en GitHub Pages, auth de Supabase **reutilizando el patrón de `crm.html`** (misma sesión/login, mismo init de supabase-js, mismo guard).
- `puente.html` lee/escribe `zernio_conversacion` directo por supabase-js (RLS). Las llamadas a Zernio (que necesitan la key) van siempre por Edge Function.

---

## Tablas

### `zernio_cuenta` — lista de cuentas/WABA conectadas (config como datos)
> Multi-cuenta desde el arranque, manejado por esta lista. **Sumar un cliente = agregar una fila, sin tocar código.** Hoy: una sola fila (el número del piloto).

| Columna | Tipo | Notas |
|---|---|---|
| `zernio_account_id` | text PK | El `accountId` de la cuenta en Zernio. |
| `label` | text NOT NULL | Nombre legible del cliente (p.ej. `Piloto`). |
| `activa` | boolean NOT NULL | `default true`. Las inactivas no se sincronizan ni se muestran. |
| `created_at` | timestamptz | `default now()` |

- La `ZERNIO_API_KEY` sigue siendo **una sola** (secret de Supabase); esta tabla solo lista los `accountId`. Nunca guardar la key acá.
- RLS: igual que el resto de `zernio_*`.

### `zernio_conversacion` — un registro por conversación CTWA entrante
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | `default gen_random_uuid()` |
| `zernio_account_id` | text NOT NULL | FK → `zernio_cuenta(zernio_account_id)`. |
| `conversation_id` | text NOT NULL | `_id` de la conversación en Zernio. |
| `phone_e164` | text | Dígitos, sin `+`. |
| `nombre` | text NULL | Si Zernio lo trae. |
| `ctwa_clid` | text NULL | Click id. NULL si Meta no lo mandó aún. |
| `ctwa_source_id` | text NULL | Id del creativo/anuncio. |
| `ctwa_source_url` | text NULL | |
| `ctwa_headline` | text NULL | Titular del anuncio (contexto para clasificar). |
| `ctwa_source_type` | text NULL | p.ej. `ad`. |
| `ctwa_captured_at` | timestamptz NULL | |
| `primer_mensaje` | text NULL | Opcional, snippet del primer mensaje para dar contexto al humano. |
| `estado` | text NOT NULL | `default 'nuevo'`. Valores: `nuevo` \| `lead` \| `venta` \| `descartado`. CHECK. |
| `ultimo_mensaje_at` | timestamptz NULL | Para ordenar la bandeja. |
| `created_at` | timestamptz | `default now()` |
| `updated_at` | timestamptz | `default now()` |

- **UNIQUE (`zernio_account_id`, `conversation_id`)** — clave de upsert.
- Índices: `(zernio_account_id, estado)`, `(ultimo_mensaje_at desc)`.
- RLS: espejar las políticas de las tablas del camino Meta (solo el equipo lee/escribe).

### `zernio_conversion` — log de cada envío a Meta (auditoría)
> El feed de Zernio solo retiene ~30 días; este log es el histórico propio.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | `default gen_random_uuid()` |
| `conversacion_id` | uuid NOT NULL | FK → `zernio_conversacion(id)` `on delete cascade`. |
| `zernio_account_id` | text NOT NULL | Denormalizado. |
| `conversation_id` | text NOT NULL | Denormalizado, trazabilidad. |
| `event_name` | text NOT NULL | `LeadSubmitted` \| `Purchase`. CHECK. |
| `event_id` | text NOT NULL | Estable para dedup. **UNIQUE.** Formato: `zpuente:<conversation_id>:<event_name>`. |
| `value` | numeric NULL | |
| `currency` | text NULL | p.ej. `ARS`. |
| `estado_envio` | text NOT NULL | `enviado` \| `fallido` \| `sin_clid`. |
| `events_received` | int NULL | De la respuesta de Zernio. |
| `events_failed` | int NULL | |
| `trace_id` | text NULL | `fbtrace_id` para Events Manager. |
| `error` | jsonb NULL | `failures[]` o mensaje. |
| `test_code` | text NULL | Si se mandó como test. |
| `created_at` | timestamptz | `default now()` |

- Índice: `(conversacion_id)`.
- `event_id` prefijado con `zpuente:` para no colisionar con los event_id del camino Meta. Supuesto v1: un `LeadSubmitted` y un `Purchase` por conversación (reenviar el mismo = idempotente por dedup). Si hiciera falta múltiples compras por conversación, revisar el formato del `event_id`.

---

## Edge Functions (`zernio-*`, Deno)

Ambas: HTTP POST, autenticadas con la sesión de Supabase del front (mismo esquema que usa `crm.html` para llamar functions). Leen la key de `ZERNIO_API_KEY` (secret de Supabase).

### `zernio-sync` — ingesta bajo demanda
**Recibe:** `{ zernio_account_id?: string, since_days?: number }` (default `since_days = 7`; sin account = todas las filas `activa=true` de `zernio_cuenta`).

**Hace:**
1. Resuelve las cuentas a sincronizar leyendo `zernio_cuenta` (`activa=true`). Para cada una, lista conversaciones recientes de Zernio, paginando. → ⚠️ **Claude Code: confirmar endpoint y params exactos de listado/paginación/filtro en https://docs.zernio.com/messages/list-inbox-conversations.** Acá va el contrato, no los params exactos de Zernio.
2. Filtra a las conversaciones con datos CTWA (las que tienen `metadata.ctwa_clid` o campos de referral).
3. **Upsert** en `zernio_conversacion` por (`zernio_account_id`, `conversation_id`): setea `phone_e164`, `nombre`, todos los `ctwa_*`, `primer_mensaje`, `ultimo_mensaje_at`, `updated_at`. **`ON CONFLICT` NO pisa `estado`** (preserva la clasificación humana).

**Devuelve:** `{ ok: true, synced: <int> }` o `{ ok: false, error: <string> }`.

> El front no recibe la lista de acá: la lee directo de `zernio_conversacion` por supabase-js después de sincronizar.

### `zernio-conversion` — clasificar lead/venta + enviar a Meta
**Recibe:** `{ conversacion_id: uuid, event_name: 'LeadSubmitted' | 'Purchase', value?: number, currency?: string, test?: boolean }`.

**Hace:**
1. Carga `zernio_conversacion` por `id`. **Si `ctwa_clid` es NULL** → loguea en `zernio_conversion` con `estado_envio='sin_clid'`, **no llama a Zernio**, devuelve `{ ok:false, code:'sin_clid' }`. (Solo se manda evento si hay clid.)
2. `event_id = 'zpuente:' + conversation_id + ':' + event_name`.
3. Llama `POST /v1/whatsapp/conversions` de Zernio con `{ accountId: zernio_account_id, conversationId, eventName: event_name, eventId: event_id, value?, currency?, testCode? }`.
4. Evalúa respuesta: `200` + `eventsReceived>=1` + `eventsFailed=0` → `enviado`; si no → `fallido` (guardar `failures`/`trace_id`). Mapear `422` (sin clid / sin dataset) y `404` (conversación inexistente) a error legible.
5. **Upsert** en `zernio_conversion` por `event_id` (reintentar = idempotente).
6. Si `enviado`: update `zernio_conversacion.estado` = `Purchase → 'venta'`, `LeadSubmitted → 'lead'`.

**Devuelve:** `{ ok: boolean, estado_envio: 'enviado'|'fallido'|'sin_clid', trace_id?, events_received?, events_failed?, error? }`.

> `descartar` NO pasa por acá: es un update directo de `estado='descartado'` por supabase-js, sin enviar nada.

---

## `puente.html` — flujo

Página standalone en GitHub Pages, misma auth que `crm.html`. Solo toca `zernio_*` y las dos functions.

**Aviso visible en la UI (no es un inbox):** un subtítulo/banner deja claro que `puente.html` muestra **solo conversaciones que vienen de anuncios** (con referral CTWA), no todos los mensajes de WhatsApp. El equipo sigue respondiendo donde lo hace hoy; esto es solo para atribuir leads de pauta.

**Bandeja** (lista/tabla de conversaciones CTWA):
- Columnas: contacto (nombre / teléfono) · headline del anuncio · contexto (primer mensaje si está) · estado · atribución (✓ con clid / ⚠ sin clid) · última actividad · **deadline de atribución**.
- **Deadline de atribución (clave):** la ventana de Meta son 7 días **desde el clic**, no desde el último mensaje → `ctwa_captured_at + 7 días`. La fila muestra "quedan X días". Urgencia visual: **rojo cuando faltan <48 h**; cuando ya venció y sigue sin clasificar, marcar **"vencida — no atribuible"** (enviar post-7d igual postea pero Meta no atribuye). Sin `ctwa_captured_at` (sin clid) → no hay deadline, muestra "sin clid". La urgencia aplica mientras `estado ∈ {nuevo, lead}`; `venta`/`descartado` ya están resueltas. **Orden por defecto:** `nuevo`/`lead` primero, por deadline ascendente (lo que está por vencer arriba). Es el mecanismo para que una conversión no se pierda en silencio.
- **Filtro por cuenta:** si hay más de una fila `activa` en `zernio_cuenta`, mostrar un selector de cuenta/cliente para filtrar la bandeja. Con una sola cuenta, no se muestra el filtro.
- **Botón "Sincronizar"** → llama `zernio-sync`, luego recarga la lista desde Supabase. Más un sync automático al abrir la página. (Auto cada ~60s mientras está abierta: opcional.)
- **Por fila:** `[Marcar lead]` `[Marcar venta]` `[Descartar]`.
  - **Lead / Venta** → llama `zernio-conversion`; spinner → resultado (✓ enviado con trace, o error visible). **Venta** abre un modal corto para `value` + `currency` (default `ARS`). Lead: `value`/`currency` opcionales.
  - **Descartar** → update directo en Supabase (`estado='descartado'`).
  - Si `ctwa_clid` es NULL: lead/venta deshabilitados con aviso "sin clid aún — sincronizá más tarde"; descartar permitido.

**Identidad visual:**
- Paleta: `#FF82FF` `#D3FF99` `#F26A8D` `#CBEEF3` `#FFFFFF`. **Dosificada, no todo fucsia.** Base clara (blanco / `#CBEEF3`), acentos fucsia/coral puntuales. `#D3FF99` (verde) para estado **venta**.
- Fuentes: **Biro Script** (display/títulos), **Salford** (texto).
- Estados: `nuevo` neutro · `lead` fucsia/coral · `venta` verde · `descartado` gris/atenuado.

Sin métricas, sin asignación, sin chat. Nada más.

---

## Setup (una vez, por cuenta/WABA)
1. Conectar la WhatsApp account en Zernio (Embedded Signup, o credentials con scope `whatsapp_business_manage_events`).
2. `POST /v1/whatsapp/dataset` con el `accountId` → provisiona el dataset `business_messaging` (idempotente). Requiere **verificación de negocio de la WABA hecha** (si no, Meta rechaza con `(#100)`).
3. `supabase secrets set ZERNIO_API_KEY=...`.
4. Migration de tablas `zernio_*` + deploy de `zernio-sync` y `zernio-conversion` (CLI) + subir `puente.html`.
5. Insertar la fila del piloto en `zernio_cuenta` (`zernio_account_id`, `label='Piloto'`, `activa=true`).

## Notas para la implementación (confirmar/espejar en el repo real)
- **Auth y RLS:** copiar exactamente cómo `crm.html` inicializa supabase-js, maneja sesión y define RLS. `puente.html` y las tablas `zernio_*` usan el mismo patrón.
- **Listado de conversaciones de Zernio:** confirmar endpoint, filtros (CTWA / since) y paginación reales antes de codear `zernio-sync`.
- **Dataset:** verificar que la WABA tenga verificación de negocio antes de provisionar.
- **Nombres de eventos:** solo `LeadSubmitted` y `Purchase` (Zernio rechaza `Lead` a secas y otros).

## Fuera de v1 (explícito)
- Webhook `whatsapp.automatic_event` (recupera clid tardío). No en v1: el re-sync levanta el clid si aparece y el humano reintenta.
- Métricas / dashboards · responder mensajes / inbox / bots · asignación entre personas.

## Cuentas (decisión cerrada)
Multi-cuenta desde el arranque, manejado por la tabla `zernio_cuenta` (lista como datos). Hoy una sola fila (el piloto). Sumar 2° y 3° cliente = agregar filas, sin tocar código. La bandeja muestra el filtro por cuenta solo cuando hay más de una activa. Sin segunda iteración cuando escale.
