# CoMakers · dónde quedó todo — 15/09/2026

Pegá este archivo (o subilo como adjunto) al abrir el chat nuevo.
Reemplaza por completo al del 12/09, que quedó viejo esa misma noche.

---

## Quién soy y cómo trabajo

Delfi, agencia de marketing digital en Tandil (CoMakers). Panel donde los
clientes ven sus reportes mensuales de Meta.

- Stack: HTML/CSS/JS vanilla en un solo archivo, Supabase (base + edge
  functions), repo en `~/Desktop/Aplicaciones/CoMakers/HubCoMakers`,
  publicado en `comakers.com.ar` vía GitHub Pages.
- Proyecto Supabase: `ggcstolnadkkqhsqpzql`.
- Antes de cambios grandes, decime qué decisiones vas a tomar y por qué.
  Dame tu recomendación honesta. Si algo es mala idea o se va a romper,
  decímelo.
- Comandos y snippets **completos y listos para copiar**, no en fragmentos.
- Yo te paso capturas; vos me pasás archivos para descargar y comandos.
- **Subí los archivos grandes como adjunto, no por capturas.** Pedir
  `sed -n 'X,Yp'` cuatro veces y que no llegue nos costó horas el 12/09.

### El método que funcionó para editar archivos grandes

Parches en Python con anclas de texto exacto, que verifican TODAS las
anclas antes de escribir y no tocan nada si una sola no coincide. Dejan
`.bak-*` y son idempotentes. Para `panel.html` conviene además extraer
el `<script>` y correrle `node --check` antes de entregarlo: eso evitó
subir un panel roto más de una vez.

---

## Lo que funciona hoy

### Datos de Meta, automáticos
- **`pull-instagram`** — métricas mensuales de IG → columnas `_org` de
  `reporte`.
- **`pull-posts`** — posts del mes → `post_instagram`, miniaturas en el
  bucket privado `post-thumbs`.
- **`pull-ads`** — totales → columnas `_ads` de `reporte`, y detalle por
  anuncio → `anuncio_meta`, miniaturas en el mismo bucket.
- **`analizar-reporte`** — escribe el borrador del análisis. **Es el único
  componente con costo por uso** (API de Claude, modelo `claude-opus-5`).
  Entre 3 y 8 centavos de dólar por reporte: el costo nunca fue el tema.
- **`meta-cuentas`** — lista páginas y cuentas publicitarias del token.

### El cron
`sync_diario()` corre a las **06:00 UTC = 03:00 AR** todos los días.
Dispara los pulls según qué módulo tenga prendido cada cliente, sobre el
mes en curso (y los primeros 3 días del mes, también el anterior).

**Desde el 12/09 también dispara el análisis**: del día 4 al 10 llama a
`analizar-reporte` para el mes que cerró, solo sobre reportes sin publicar
y sin texto escrito. La ventana de 7 días es para que una noche caída no
haga perder el mes. Primera corrida real: **4 de octubre**.

⚠️ **El log del cron dice timeout y NO es un error.** pg_net no espera a
que la función termine. El registro que vale es
`cliente_integracion.ultimo_sync` / `ultimo_error`.

### El análisis (reescrito el 12 y 13/09)
El prompt viejo le prohibía explicar causas y proponer acciones, y por eso
los análisis describían números sin concluir. Ahora:

- Se le dice explícitamente que **escribe un BORRADOR que Delfi revisa**.
  Eso cambia el nivel de riesgo que puede asumir: si se equivoca ella lo
  corrige; si no dice nada, ella escribe todo de cero.
- Puede conectar números entre sí y sacar la lectura ("la inversión bajó
  61% y el costo por conversación bajó 26%: cada peso rindió mejor").
- Puede marcar hipótesis como hipótesis ("habría que mirar si…").
- Puede cerrar con un plan, en modo recomendación, nunca compromiso.
- **Sigue sin poder** explicar causas fuera de los datos: no vio la imagen
  ni el copy ni sabe qué pasó en el negocio.
- Devuelve **cinco bloques** con marcadores (`[RESUMEN]`, `[CUENTA]`,
  `[ORGANICO]`, `[PAUTA]`, `[PROXIMOS]`), no JSON — el texto tiene
  comillas, saltos y emojis, y un JSON mal escapado un día no parsea y no
  se guarda nada. Si no respeta el formato, todo el texto cae en
  `analisis` y la respuesta trae `respeto_formato: false`.

### El panel (`panel.html`) — reestructurado el 14 y 15/09
- **Izquierda: navegación del panel.** Hoy solo "Reportes"; ahí se suman
  los módulos que vengan (Calendario, etc.).
- **Arriba: filtro de meses como solapas**, con el mismo lenguaje visual
  que las solapas del reporte. Es genérico a propósito: sirve igual para
  cualquier módulo nuevo.
- **Tres solapas por reporte: Cuenta / Orgánico / Pauta.** Un módulo
  apagado en `cliente_modulo` no dibuja su solapa. Con un solo módulo no
  se dibujan solapas.
- **Orden dentro de cada solapa:** fila de destacadas → métricas →
  publicaciones o anuncios → secciones que escribe la agencia → análisis.
  Primero los números, al final la lectura.
- **Secciones editables** (`reporte.bloques`, jsonb): título, pregunta y
  cuerpo, con Agregar / Editar / Borrar desde el propio reporte. Es la
  estructura de los reportes en Word. Viven en una columna de `reporte`,
  así que **heredan su RLS**: el cliente no las ve en borrador.
- Sin "+ Otro mes": la agencia ve los últimos 12 meses + los que tengan
  reporte; el cliente solo los meses con reporte.

### La administración (`administracion.html`)
Chips "Orgánico" y "Pauta" en el modal de cliente, que escriben en
`cliente_modulo`. Eso es lo que prende y apaga las solapas del panel.

---

## Clientes cargados

| Cliente | id | Instagram | Ads | Módulos |
|---|---|---|---|---|
| FOS Gestiones Inmobiliarias | `287db773-625a-48c4-8bb5-0c5f6ed0cd06` | `17841466933923139` | `act_483803057555648` | los dos |
| Visitando Tandil | `370fad4b-a82f-421a-827f-67b3c64fe0eb` | `17841463436895688` | — | solo orgánico |

Hay 26 clientes en la base; estos dos son los que tienen integraciones.
EKHOS (`90a7f1b9-…`) existe pero sin integraciones cargadas.

---

## Cosas que NO hay que volver a descubrir

**El alcance de Meta a nivel CUENTA viene roto de forma intermitente.** El
guardián está en `_shared/alcance.ts`: si `reach < views/10`, escribe null
y anota el motivo. **Nunca mostrar 0 donde hay null.**

**El alcance a nivel POST funciona bien.** Verificado el 11/09: ratios
reach/views entre 43% y 71%. Son endpoints distintos.

**El engagement se calcula sobre views, no sobre reach**, porque el reach
de cuenta falla. Hay **dos** definiciones que tienen que decir lo mismo:
`engagement()` en `panel.html` y `public.engagement_post()` en la base.
Si cambia una, cambiar la otra. Incluyen el mismo fallback: si
`interacciones` es null, suman likes+comments+saves+shares, y devuelven
null solo si las cuatro son null.

**No sumar alcance orgánico + pauta.** Cuenta dos veces a las mismas
personas. Hay regla explícita en el prompt de `analizar-reporte` y por eso
las tarjetas de la solapa Cuenta llevan rótulo de origen. **Esta regla se
perdió una vez al reescribir el prompt y hubo que reponerla**: si tocás el
prompt, verificá que siga.

**`cliente_modulo` es la única verdad sobre qué servicios tiene un
cliente.** Las columnas `clientes.rep_organico` / `rep_pauta` **ya no
existen** (borradas el 12/09). Al migrar se descubrió que FOS tenía
`rep_pauta=false` desincronizado y `pull-instagram` le escribía un
`alcance` que no correspondía: era un bug real, de antes.

**La columna `reporte.alcance` no la lee nadie.** El panel mapea la clave
'alcance' a `reach_org`. Es un vestigio; se puede limpiar algún día.

**Toda vista sobre una tabla con RLS necesita `security_invoker = true`.**
Sin eso corre con los permisos de quien la creó y saltea la RLS: cualquier
usuario autenticado podría leer por API los datos de todos los clientes.
El trigger de RLS automática cubre tablas nuevas, **no vistas**.

**Los nombres genéricos de tabla son una trampa.** `post` ya estaba tomado
por el calendario editorial del panel interno. De ahí `post_instagram` y
`anuncio_meta` con sufijo. Un `create table if not exists` sobre una tabla
existente con otro esquema no hace nada y no avisa.

**Un `rm x && cp y` donde el `cp` falla borra igual.** Commitear antes de
mover archivos.

**`&&` después de `git commit` corta la cadena si no hay nada que
commitear** (commit devuelve error). Usar `;` en esa posición.

**Si editaste archivos desde la web de GitHub, el push local rebota.**
`git pull --rebase origin main` y volver a pushear. Pasó tres veces.

**GitHub Pages + caché de Chrome.** Después de pushear, el panel puede
seguir mostrándose viejo. Verificar qué está sirviendo el servidor con
`fetch('/panel.html?x='+Date.now()).then(r=>r.text()).then(t=>console.log(t.includes('data-solapa')))`
y forzar con **Cmd+Shift+R**.

**Las rutas del bucket llevan el `cliente_id` primero**
(`{cliente_id}/{media_id}.jpg` y `{cliente_id}/ads/{ad_id}.jpg`) porque la
policy compara el primer nivel de carpeta contra el cliente_id.

**El token nunca toca el navegador.** Nada de campos para pegar tokens ni
links con credenciales en la URL. **Tampoco la API key de Anthropic**: vive
del lado servidor en `analizar-reporte`. Los cursos que la ponen en el
browser (con `anthropic-dangerous-direct-browser-access`) lo hacen porque
no tienen backend. Ponerla en el browser **no da ninguna funcionalidad
extra** y baja la arquitectura.

**Visitando Tandil trabaja con colaboraciones.** Los posts en collab no
salen por `/media` del colaborador, solo del dueño. Por eso julio y agosto
dieron cero posts propios. No es un bug y no tiene arreglo por API.

**Las migraciones están en el repo pero se corren a mano** en el SQL
Editor. Supabase no las tiene registradas como aplicadas. Si algún día se
corre `supabase db push`, las va a reintentar — están escritas para que
eso sea inofensivo (`if not exists`, `create or replace`, `on conflict do
nothing`), pero conviene saberlo.

**Lo que los cursos llaman "TRANSCRIPCIÓN" de un reel es el caption**, no
el audio. Los "hooks que más funcionaron" salen de la primera línea del
caption, que ya bajás. No hace falta transcribir nada.

**Apify no hace falta.** Sirve para scrapear cuentas que no administrás.
Para tus clientes la API te da los datos derecho, y scrapear te pone en
zona gris con Meta, con el token del que dependen los tres pulls.

**`leaked password protection` requiere plan Pro.** No es un pendiente, es
un bloqueo por plan. Lo que sí está y es gratis: mínimo 12 caracteres y
requisitos de complejidad, ya configurados.

---

## Estado de los pendientes del 12/09

1. ~~Borrar 5 archivos huérfanos de Storage~~ — **hecho**.
2. ~~Trigger de RLS automática~~ — **hecho** (Database → Policies).
3. **Token de Meta con permisos de más** — PENDIENTE, el único que queda.
   - FOS GI quedó con "Acceso total" cuando alcanza "Ver rendimiento".
     Business Manager → Usuarios del sistema → comakers-panelbot → FOS GI.
   - `ads_management` cuando solo hace falta `ads_read`. **Más delicado**:
     requiere token nuevo y reemplazar el secret `META_TOKEN`. Si sale mal
     se caen los tres pulls. **Probar `meta-cuentas` antes de dar por
     bueno y no revocar el viejo hasta verificar.**
4. ~~¿El análisis se genera solo?~~ — **hecho**, del 4 al 10.
5. ~~Sacar `rep_organico`/`rep_pauta`~~ — **hecho**, columnas borradas.
6. `SEGURIDAD-pendientes.md` sigue en el repo. Actualizarlo: el punto 1
   (RLS) y el 7 (auth) cambiaron de estado.

---

## Pendientes nuevos

**Mejor horario para publicar.** Los datos ya están calculados en
`v_timing` (ver abajo), pero con 14 posts de FOS y 3 de Visitando ningún
horario llega al mínimo de 3 que pide la regla. Se llena solo con cada
sync: recién en noviembre va a decir algo. **No mostrarlo antes**: sería
ruido con aspecto de dato.

**Hooks y palabras clave.** Misma historia: la capa está instalada, falta
volumen.

**Verificar que las secciones editables funcionan.** Se subieron el 15/09
a las 20:00 y no se llegó a confirmar que una sección creada en Pauta
aparezca en Pauta. Es lo primero a probar.

**Faltan datos para llegar al nivel de los reportes en Word:**
- Orgánico: visitas al perfil, toques en el enlace de la bio, seguidores
  vs no seguidores, demografía (edad/género/país), seguidores totales.
  **Todo eso está en la API con los permisos que ya tenés** — es un pull
  nuevo de métricas de cuenta, sin token nuevo. Es lo que más acerca el
  panel a los docx por unidad de trabajo.
- Pauta: presupuesto diario del conjunto y días con entrega (dos campos en
  `pull-ads`).
- **No existe en ninguna API** y seguirá siendo carga manual: el embudo de
  WhatsApp (conversaciones efectivas, presupuestos, reservas) y los datos
  del píxel del sitio.

**Secciones editables: falta reordenar y un campo propio para el Tip.**
Hoy se agregan al final y el tip entra en el cuerpo.

**Los reportes de Word de San Eusebio son la referencia** de a dónde tiene
que llegar el panel. Están en el chat del 15/09.

---

## La capa de contenido (instalada el 12/09, todavía sin volumen)

Cuatro vistas sobre `post_instagram`, todas con `security_invoker = true`,
ventana de 90 días:

- `v_post_enriquecido` — cada post con su hook (primera línea del caption),
  hora y día en horario argentino, y engagement.
- `v_hooks` — ganchos ordenados por rendimiento, con percentil dentro de
  la cuenta.
- `v_palabras_caption` — palabras de los captions con el engagement
  promedio de los posts donde aparecen. Ordenada por rendimiento, no por
  frecuencia. Mirar `veces` antes de concluir.
- `v_timing` — rendimiento por hora y día, con `confiable` = al menos 3
  posts detrás. **No mostrar los que no lo son.**

**SQL prepara la evidencia; la IA la interpreta.** La clasificación en
"patrones" (tipo "imperativo con palabra clave en mayúsculas") no sale de
SQL: sale del modelo leyendo estas vistas.

---

## Esquema: lo que se agregó

`reporte` ahora tiene, además de lo que ya había:
- `analisis` — solapa Cuenta (la lectura general)
- `analisis_organico`, `analisis_pauta` — las otras dos solapas
- `resumen` — dos o tres oraciones arriba de todo
- `proximos_pasos` — sostener / incorporar
- `bloques` (jsonb) — las secciones que escribe la agencia
- `analisis_generado_en` — marca de borrador sin revisar

**El guardián de lo escrito a mano:** si hay texto en `analisis` y
`analisis_generado_en` es null, lo escribió una persona y `analizar-reporte`
devuelve 409 sin pisarlo. Un borrador generado sí se regenera.

**Las policies de `reporte`:** la agencia ve todo; el cliente solo ve filas
con `estado = 'publicado'`. O sea que **en borrador el cliente no ve nada
del mes, ni los números**. Si alguna vez se quiere que vea los números
mientras el análisis sigue oculto, hay que enmascarar columnas (vista con
su propio chequeo), no filas.

---

## Lo primero que conviene chequear mañana

```sql
select c.nombre, ci.tipo, ci.ultimo_sync, ci.ultimo_error
  from public.cliente_integracion ci
  join public.clientes c on c.id = ci.cliente_id
 where ci.activo order by ci.ultimo_sync desc nulls last;
```

Si `ultimo_sync` tiene fecha de la madrugada, el cron funcionó.

---

## Cómo invoco las funciones para probar

Desde la consola del navegador, logueada en el panel (`Cmd+Option+J`):

```js
const k = Object.keys(localStorage).find(x => x.startsWith('sb-') && x.includes('auth-token'));
const tok = JSON.parse(localStorage.getItem(k)).access_token;
const r = await fetch('https://ggcstolnadkkqhsqpzql.supabase.co/functions/v1/NOMBRE-FUNCION', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
  body: JSON.stringify({ cliente_id: 'UUID', mes: '2026-09' })
});
console.log(JSON.stringify(await r.json(), null, 2));
```

`pull-posts` y `pull-ads` aceptan `debug: true` para diagnóstico sin
escribir en la base.

Deploy de una función:

```bash
cd ~/Desktop/Aplicaciones/CoMakers/HubCoMakers && npx supabase functions deploy NOMBRE --project-ref ggcstolnadkkqhsqpzql
```
