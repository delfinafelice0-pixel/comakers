# CoMakers · dónde quedó todo — 16/09/2026

Pegá este archivo (o subilo como adjunto) al abrir el chat nuevo.
Reemplaza por completo al del 15/09.

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

**Desde el 15/09 los parches del panel se prueban antes de entregarse**:
Claude abre `panel.html` en Chrome headless con
`claude_FUENTE-mock-supabase.js` (Supabase simulado, datos inventados),
hace clic, saca capturas y genera el PDF. Si Claude no puede mostrar
capturas de la prueba, pedírselas.

---

## Lo que funciona hoy

### Datos de Meta, automáticos
- **`pull-instagram`** — métricas mensuales de IG → columnas `_org` de
  `reporte`. Acepta `debug: true` (diagnóstico del alcance, no escribe).
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

### El panel (`panel.html`) — rehecho el 15 y 16/09

Cuatro parches, **en este orden** (cada uno exige el anterior). Todos
aplicados y publicados; último commit `4cd7483`.

| # | Parche | Qué hizo |
|---|---|---|
| 1 | `parche-layout.py` | Estructura igual a administración |
| 2 | `parche-pdf.py` | Botón Descargar PDF |
| 3 | `parche-anuncios.py` + `claude_migracion-panel-notas-anuncios.sql` | Lo que mejor funcionó / Lo que ajustamos |
| 4 | `parche-honesto.py` | Mes parcial, análisis viejo, sin repetidos, flechas |

**Estructura (parche 1).**
- Sidebar fijo de 240px copiado de administración, **con los mismos
  nombres de clase** (`.sidebar`, `.brand`, `.nav-item`, `.user-card`,
  `.mes-nav`) para poder sacarlos algún día a un CSS común. Logo sin
  "Panel de cliente". Caja de cliente arriba (selector para la agencia,
  nombre fijo para el cliente). "Volver al panel interno" solo agencia.
- **El mes se cambia con flechas ‹ › + "Hoy"**, igual que administración.
  **Esto reemplazó a las solapas de meses del 14/09** (con sidebar no
  entraban dos filas de solapas). La agencia recorre los últimos 12 meses
  + los que tengan reporte; el cliente salta solo entre meses con reporte
  y su botón dice "Último".
- Las flechas se dibujan dentro de cada cabecera, incluidos los meses
  vacíos: sin eso, un mes vacío dejaba a la agencia sin forma de moverse.
- **Tres solapas por reporte: Cuenta / Orgánico / Pauta.** Siguen siendo
  solapas dentro del reporte y NO ítems del sidebar, porque Editar /
  Publicar / borrador son del reporte entero. Regla: sidebar = módulos,
  solapas = vistas de un módulo.
- **La solapa abierta se recuerda** (`SOLAPA`): guardar una sección o una
  nota ya no te devuelve a Cuenta. Al cambiar de cliente vuelve a Cuenta.
- En el celular (≤900px) el menú se abre desde una barra arriba.

**Fila de destacadas.** La primera tarjeta de cada solapa va ancha y en
oscuro. Pauta: resultados. Orgánico: alcance. **Cuenta: los resultados de
la pauta, NO el alcance** (el alcance en oscuro invita a leerlo como total
y orgánico + pago no se suma); si el cliente no tiene pauta, alcance
orgánico. Las listas viven en `DESTACADAS_MOD` / `ALIAS_MOD`.

**"Más números" (parche 4).** La grilla de abajo **no repite lo que ya está
en la fila de destacadas** (`enDestacadas()`). En Pauta se sumaron clics,
frecuencia y CPM, que ya se traían y no se mostraban, con una línea de
ayuda cada una (un cliente no sabe qué es CPM).

**Flechas y colores (parche 4).** La flecha dice hacia dónde fue el número;
el color, si eso es bueno. Antes la flecha seguía al color y un costo que
bajó decía "▲ -32%". **Inversión y frecuencia van en gris (`neutro`)**:
bajar la inversión fue una decisión, en rojo el cliente leía "malo".

**Mes en curso = reporte parcial (parche 4).**
- Marca "parcial · datos al 16 de septiembre" en pantalla, en el PDF
  ("Reporte parcial") y en el nombre del archivo.
- **Los totales NO se comparan contra el mes anterior**: dicen "mes en
  curso". Un total al día 16 siempre "baja" contra un mes completo. Solo
  se comparan las tasas: `TASAS = costo_resultado, costo_por_resultado,
  ctr, cpm`. Frecuencia es acumulativa: no entra.

**Análisis desactualizado (parche 4).** Si `ultima sincronización >
analisis_generado_en` (+1 minuto), cartel rosado bajo el análisis (solo
agencia) y aviso extra al descargar el PDF. **Solo cubre borradores sin
revisar**: un análisis revisado en el mes en curso también queda viejo
cuando el cron actualiza, y no hay forma de detectarlo. **Práctica: revisar
el análisis recién cuando el mes cerró.**

**PDF (parche 2).** Botón que abre el diálogo de impresión ("Guardar como
PDF"), no una librería: texto nítido, ~150 KB, sirve para WhatsApp. Todo lo
de papel vive en `@media print` con `.solo-pdf` / `.solo-pantalla`.
- Salen las tres solapas, cada una desde página nueva, con su título.
- No salen: menú, flechas, botones, "+ Agregar sección", avisos internos,
  análisis vacíos, "Traído de Meta el…", la pastilla de borrador.
- Fondos forzados con `print-color-adjust: exact` (sin eso la tarjeta
  oscura salía blanco sobre blanco).
- Antes de imprimir se fuerzan las miniaturas `loading="lazy"`: las de
  solapas no abiertas nunca se habían bajado y salían en blanco.
- Nombre del archivo = `document.title` temporal: "Cliente – Reporte
  septiembre 2026".
- Si el análisis es borrador sin revisar, pregunta antes.
- Uso: en Chrome desmarcar **"Encabezados y pies de página"** una vez. Las
  miniaturas firmadas vencen a la hora: si la pestaña quedó abierta,
  recargar antes de descargar.

**Pauta: Lo que mejor funcionó / Lo que ajustamos (parche 3).**
- Solo se comparan anuncios **con el mismo objetivo que el reporte**
  (`accion_ads`). El promedio sale de esos mismos anuncios.
- **Mejores:** al menos `MIN_RESULTADOS = 5`, costo ≤ promedio, máximo 3,
  y solo si hay 2 o más anuncios que cumplan el mínimo. Ordenados por
  costo por resultado, no por cantidad (el que más trae suele ser el que
  más plata recibió).
- **Ajustes:** al menos `MIN_PARTE_AJUSTE = 10%` de la inversión del mes y
  costo ≥ `UMBRAL_CARO = 1,5×` el promedio, o sin resultados. **El cliente
  solo ve los que tienen nota escrita**; sin notas, la sección no existe
  para él ni en el PDF.
- Cada anuncio lleva nota de la agencia: "Por qué creemos que funcionó" /
  "Qué hicimos". **El porqué lo escribe la agencia, no Claude**: los
  números no saben de la pieza, el copy ni el gancho.
- Una nota escrita para una sección no se muestra si el anuncio cambió de
  lado (pasa en el mes en curso); al editar aparece el texto anterior.
- Guardar relee las notas y cambia solo esa, para no pisar otra escrita
  en paralelo.
- Visto con datos reales de FOS el 16/09: "casa madera" fue el único mejor
  (30% más barato); ningún anuncio llegó a ajuste.
- Riesgo conocido: un anuncio chico con suerte puede quedar primero (en la
  prueba, un reel de $3.000 con 8 conversaciones). Si pasa con datos
  reales, subir `MIN_RESULTADOS` o sumar un mínimo de inversión.

**Nombres de anuncio.** Se muestra lo que va después del último " | "
("Creativo nuevo | Reel Hortensias" → "Reel Hortensias"). En Meta no se
toca. **El texto de `analizar-reporte` sigue usando el nombre completo.**

**Secciones editables** (`reporte.bloques`, jsonb): título, pregunta y
cuerpo, con Agregar / Editar / Borrar desde el propio reporte. Heredan la
RLS de `reporte`: el cliente no las ve en borrador.

### La administración (`administracion.html`)
Chips "Orgánico" y "Pauta" en el modal de cliente, que escriben en
`cliente_modulo`. Eso es lo que prende y apaga las solapas del panel.
Tiene el link "Ver panel de cliente" apuntando a `panel-comakers.html`
(nombre viejo): revisar que abra `panel.html`.

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
guardián descarta el reach si `reach < views/10`, escribe null y anota el
motivo. **Nunca mostrar 0 donde hay null.**
⚠️ El contexto del 15/09 decía que el guardián estaba en
`_shared/alcance.ts`. **El `pull-instagram` revisado el 16/09 lo tiene
inline (bloque 3.b) y no importa nada de `_shared`.** Delfi no encontró
`_shared`. Antes de modificar `pull-instagram`, confirmar que el archivo
del repo es el mismo que está deployado (Edge Functions → pull-instagram →
Code): deployar un archivo viejo revierte cambios sin avisar.

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

**La misma métrica de pauta tiene dos nombres.** `pull-ads` escribe
`costo_resultado` y `alcance_pauta`; un reporte cargado a mano usa
`costo_por_resultado` y `alcance`. Hasta el 15/09 la fila de destacadas
buscaba solo el nombre manual y en los meses traídos de Meta faltaban
tarjetas. `ALIAS_MOD` resuelve las dos. Si se agrega una métrica, revisar
los dos nombres.

**Un total de mes a medias no se compara contra un mes completo.** Ver
"Mes en curso" arriba. Aplica también a cualquier texto o gráfico nuevo.

**`mesActual()` del panel usa UTC** (`toISOString`): desde las 21:00 AR del
último día del mes, el panel cree que ya es el mes siguiente (marca
parcial, botón Hoy). `pull-instagram` sí usa Buenos Aires. Es chico; se
arregla la próxima vez que se toque el panel.

**`cliente_modulo` es la única verdad sobre qué servicios tiene un
cliente.** Las columnas `clientes.rep_organico` / `rep_pauta` **ya no
existen** (borradas el 12/09). Sin fila en `cliente_modulo` = prendido.

**La columna `reporte.alcance` no la lee nadie.** El panel mapea la clave
'alcance' a `reach_org`. Es un vestigio; se puede limpiar algún día.

**Toda vista sobre una tabla con RLS necesita `security_invoker = true`.**
Sin eso corre con los permisos de quien la creó y saltea la RLS: cualquier
usuario autenticado podría leer por API los datos de todos los clientes.
El trigger de RLS automática cubre tablas nuevas, **no vistas**.

**Datos de la agencia que dependen del estado del reporte van en
`reporte`, no en tablas de datos de Meta.** `anuncio_meta` y
`post_instagram` las reescriben los pulls y no siguen el estado de
borrador. Por eso las notas de anuncios viven en `reporte.notas_anuncios`.

**Una columna nueva que el panel lee va en consulta aparte**, no en el
select principal de `reporte`: si la migración todavía no corrió, la
consulta falla sola y el reporte carga igual. Así se hizo con
`notas_anuncios`.

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

**GitHub Pages tarda 1 a 3 minutos en publicar** después del push. Probar
antes da "viejo" y parece que falló. Esperar con:

```bash
until curl -s "https://comakers.com.ar/panel.html?x=$(date +%s)" | grep -q 'TEXTO-QUE-SOLO-TIENE-LA-VERSION-NUEVA'; do echo 'todavía no...'; sleep 20; done; echo 'Publicado'
```

y después **Cmd+Shift+R**. El `fetch(...)` va en la consola de Chrome,
nunca en la terminal.

**zsh rompe con `!` dentro de comillas dobles** (`"¡Publicado!"` deja la
terminal en `dquote>`). Salir con Ctrl+C y usar comillas simples.

**Los `.bak-*` de los parches están en `.gitignore`.** Sin eso un
`git add -A` los publicaba en comakers.com.ar.

**Las rutas del bucket llevan el `cliente_id` primero**
(`{cliente_id}/{media_id}.jpg` y `{cliente_id}/ads/{ad_id}.jpg`) porque la
policy compara el primer nivel de carpeta contra el cliente_id.

**El token nunca toca el navegador.** Nada de campos para pegar tokens ni
links con credenciales en la URL. **Tampoco la API key de Anthropic**: vive
del lado servidor en `analizar-reporte`. Ponerla en el browser **no da
ninguna funcionalidad extra** y baja la arquitectura.

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
3. **Token de Meta con permisos de más** — PENDIENTE.
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

## Pendientes

**EN CURSO (16/09): métricas de cuenta en `pull-instagram`.** Visitas al
perfil, toques en enlaces, vistas de seguidores vs no seguidores,
seguidores totales, demografía. Con los permisos que ya hay. Ver la
propuesta del chat del 16/09. Dos cosas a no olvidar:
- **Seguidores totales y demografía son una foto del momento.** La API da
  cuántos hay hoy, no cuántos había el 31 de agosto: los meses pasados no
  se reconstruyen. Se acumulan desde que se empiecen a guardar.
- **Demografía:** Meta la devuelve solo con 100 seguidores o más (a
  confirmar con la cuenta real).
- **Primero un diagnóstico sin escribir** para ver qué métricas devuelve
  realmente la API v26 para FOS y Visitando; recién después migración.

**`analizar-reporte`:**
- Que no use la nomenclatura interna de los anuncios ("Creativo nuevo | ").
- Botón "Generar de nuevo" en el cartel de análisis desactualizado. Según
  el guardián de la función, un borrador generado sí se regenera, así que
  probablemente es solo un cambio del panel (hoy el botón aparece solo
  cuando no hay texto). Confirmar leyendo la función.

**Mejor horario para publicar.** Los datos ya están calculados en
`v_timing`, pero con 14 posts de FOS y 3 de Visitando ningún horario llega
al mínimo de 3. Recién en noviembre va a decir algo. **No mostrarlo
antes**: sería ruido con aspecto de dato. Meta tiene además una métrica de
"cuándo están conectados tus seguidores" que no depende del volumen: no se
sabe si sobrevivió a los recortes de métricas; probarla antes de prometer.

**Hooks y palabras clave.** Misma historia: la capa está instalada, falta
volumen.

**Verificar que las secciones editables funcionan con datos reales**:
crear una en Pauta, confirmar que queda en Pauta.

**Pauta: presupuesto diario del conjunto y días con entrega** (dos campos
en `pull-ads`).

**No existe en ninguna API** y seguirá siendo carga manual: el embudo de
WhatsApp (conversaciones efectivas, presupuestos, reservas) y los datos
del píxel del sitio. Cuando exista la pantalla de Consultas del CRM, sale
de ahí.

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

`reporte` tiene, además de lo que ya había:
- `analisis` — solapa Cuenta (la lectura general)
- `analisis_organico`, `analisis_pauta` — las otras dos solapas
- `resumen` — dos o tres oraciones arriba de todo
- `proximos_pasos` — sostener / incorporar
- `bloques` (jsonb) — las secciones que escribe la agencia
- `analisis_generado_en` — marca de borrador sin revisar
- **`notas_anuncios` (jsonb, 16/09)** —
  `{ad_id: {tipo: "mejor"|"ajuste", texto, escrita_en}}`. Default `{}`.
  Migración: `claude_migracion-panel-notas-anuncios.sql` (corrida y
  verificada: `authenticated` tiene SELECT y UPDATE).

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

Para entender por qué un anuncio entra o no en "Lo que mejor funcionó":

```sql
with a as (
  select nombre, accion, inversion, resultados,
         round(inversion / nullif(resultados, 0)) as costo
  from anuncio_meta
  where cliente_id = (select id from clientes where slug = 'fos')
    and mes = '2026-09-01' and coalesce(impresiones, 0) > 0
)
select nombre, accion, inversion, resultados, costo,
       round(100.0 * inversion / sum(inversion) over (), 1) as pct_de_la_plata,
       round(sum(inversion) over (partition by accion)
             / nullif(sum(resultados) over (partition by accion), 0)) as promedio_del_objetivo
from a
order by accion, costo nulls last;
```

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

`pull-instagram`, `pull-posts` y `pull-ads` aceptan `debug: true` para
diagnóstico sin escribir en la base.

Deploy de una función:

```bash
cd ~/Desktop/Aplicaciones/CoMakers/HubCoMakers && npx supabase functions deploy NOMBRE --project-ref ggcstolnadkkqhsqpzql
```
