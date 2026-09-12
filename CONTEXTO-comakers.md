# CoMakers · dónde quedó todo — 12/09/2026

Pegá este archivo (o su contenido) al abrir el chat nuevo.

---

## Quién soy y cómo trabajo

Delfi, agencia de marketing digital en Tandil (CoMakers). Panel donde los
clientes ven sus reportes mensuales de Meta.

- Stack: HTML/CSS/JS vanilla en un solo archivo, Supabase (base + edge
  functions), repo en `~/Desktop/Aplicaciones/CoMakers/HubCoMakers`, publicado
  en `comakers.com.ar` vía GitHub Pages.
- Proyecto Supabase: `ggcstolnadkkqhsqpzql`.
- Antes de cambios grandes, decime qué decisiones vas a tomar y por qué. Dame
  tu recomendación honesta. Si algo es mala idea o se va a romper, decímelo.
- Comandos y snippets **completos y listos para copiar**, no en fragmentos.
- Yo te paso capturas; vos me pasás archivos para descargar y comandos.

---

## Lo que funciona hoy

### Datos de Meta, automáticos
- **`pull-instagram`** — métricas mensuales de IG → tabla `reporte` (columnas
  `_org`).
- **`pull-posts`** — posts del mes → tabla `post_instagram`, con miniaturas en
  el bucket privado `post-thumbs`.
- **`pull-ads`** — totales de pauta → columnas `_ads` de `reporte`, y detalle
  por anuncio → tabla `anuncio_meta`, con miniaturas en el mismo bucket.
- **`analizar-reporte`** — escribe el borrador del análisis leyendo orgánico,
  pauta, los 5 posts de mayor alcance y los 5 anuncios de mayor inversión.
  **Es el único componente con costo por uso** (API de Claude). Hoy es a
  pedido, con botón.
- **`meta-cuentas`** — lista páginas y cuentas publicitarias del token.

### El cron
`sync_diario()` corre a las **06:00 UTC = 03:00 AR** todos los días. Dispara
los pulls según qué módulo tenga prendido cada cliente, sobre el mes en curso
(y los primeros 3 días del mes, también el anterior).

⚠️ **El log del cron dice timeout y NO es un error.** pg_net no espera a que la
función termine. El registro que vale es `cliente_integracion.ultimo_sync` /
`ultimo_error`.

### El panel (`panel.html`)
- Secciones Orgánico y Pauta con datos de Meta, respetando `cliente_modulo`.
- "Las publicaciones que mejor funcionaron" — top 3 por alcance / engagement /
  guardados, del mes elegido.
- "Rendimiento por formato" — promedio de alcance y engagement, **ventana de
  90 días** (no del mes: con los posts de un mes solo los promedios se mueven
  demasiado). Formatos con menos de 3 posts muestran guion.
- "En qué se invirtió" — 5 anuncios ordenados por inversión con su % del total.
- Sin "+ Otro mes": la agencia ve los últimos 12 meses + los que tengan
  reporte; el cliente solo los meses con reporte. La agencia arranca en el mes
  en curso, el cliente en su último reporte.

### La administración (`administracion.html`)
Chips "Orgánico" y "Pauta" en el modal de cliente, que escriben en
`cliente_modulo`.

---

## Clientes cargados

| Cliente | id | Instagram | Ads | Módulos |
|---|---|---|---|---|
| FOS Gestiones Inmobiliarias | `287db773-625a-48c4-8bb5-0c5f6ed0cd06` | `17841466933923139` | `act_483803057555648` | los dos |
| Visitando Tandil | `370fad4b-a82f-421a-827f-67b3c64fe0eb` | `17841463436895688` | — | solo orgánico |

EKHOS (`90a7f1b9-…`) existe como cliente pero sin integraciones cargadas.

---

## Cosas que NO hay que volver a descubrir

**El alcance de Meta a nivel CUENTA viene roto de forma intermitente.** El
guardián está en `_shared/alcance.ts`: si `reach < views/10`, escribe null y
anota el motivo. **Nunca mostrar 0 donde hay null.**

**El alcance a nivel POST funciona bien.** Se verificó el 11/09: ratios
reach/views entre 43% y 71% en los 9 posts de FOS. Son endpoints distintos.

**El engagement se calcula sobre views, no sobre reach**, justamente porque el
reach de cuenta falla. La fórmula está en `panel.html`, en la función
`engagement()`, y es la única definición del proyecto.

**No sumar alcance orgánico + pauta.** Cuenta dos veces a las mismas personas.
Meta no expone el alcance unificado. Hay una regla explícita en el prompt de
`analizar-reporte` por esto.

**Los nombres genéricos de tabla son una trampa.** `post` ya estaba tomado por
el calendario editorial del panel interno. De ahí `post_instagram` y
`anuncio_meta` con sufijo. Un `create table if not exists` sobre una tabla
existente con otro esquema no hace nada y no avisa.

**Un `rm x && cp y` donde el `cp` falla borra igual.** Commitear antes de mover
archivos. Perdí una migración así.

**Las rutas del bucket llevan el `cliente_id` primero**
(`{cliente_id}/{media_id}.jpg` y `{cliente_id}/ads/{ad_id}.jpg`) porque la
policy compara el primer nivel de carpeta contra el cliente_id.

**El token nunca toca el navegador.** Nada de campos para pegar tokens ni links
con credenciales en la URL.

**Visitando Tandil trabaja con colaboraciones.** Los posts en collab no salen
por `/media` del colaborador, solo del dueño. Por eso julio y agosto dieron
cero posts propios. No es un bug y no tiene arreglo por API.

---

## Pendientes, en orden de lo que yo haría

1. **Borrar 5 archivos huérfanos**: Supabase → Storage → `post-thumbs` →
   carpeta `ads` → borrar. Quedaron de la ruta vieja. Dos minutos.

2. **Trigger de RLS automática**: en Database → Policies hay un botón
   "Set up trigger" que prende RLS en toda tabla nueva. Hoy se cumple a mano.

3. **Token de Meta con permisos de más**:
   - FOS GI quedó con "Acceso total" cuando alcanza "Ver rendimiento".
     Business Manager → Usuarios del sistema → comakers-panelbot → FOS GI →
     Administrar.
   - `ads_management` cuando solo hace falta `ads_read`. **Más delicado**:
     requiere generar un token nuevo y reemplazar el secret `META_TOKEN`. Si
     sale mal se caen los tres pulls. Probar `meta-cuentas` antes de dar por
     bueno.

4. **¿El análisis se genera solo?** Decisión pendiente: es el único componente
   con costo por llamada. Mi recomendación fue una vez por mes por cliente,
   cuando el mes cierra, no todos los días.

5. **Terminar de sacar `rep_organico` / `rep_pauta`** de `clientes`. Están
   marcadas OBSOLETAS pero `pull-instagram` todavía lee `rep_pauta`.

6. **`SEGURIDAD-pendientes.md`** está en el repo y al día hasta hoy. Tiene el
   resto de los pendientes viejos del panel interno.

---

## Lo primero que conviene chequear mañana

El cron corre solo por primera vez a las 3 AM. En el SQL Editor:

```sql
select c.nombre, ci.tipo, ci.ultimo_sync, ci.ultimo_error
  from public.cliente_integracion ci
  join public.clientes c on c.id = ci.cliente_id
 where ci.activo order by ci.ultimo_sync desc nulls last;
```

Si `ultimo_sync` tiene fecha de la madrugada, funcionó.

---

## Cómo invoco las funciones para probar

Desde la consola del navegador, logueada en el panel (`Cmd+Option+J`):

```js
const k = Object.keys(localStorage).find(x => x.startsWith('sb-') && x.includes('auth-token'));
const tok = JSON.parse(localStorage.getItem(k)).access_token;
const r = await fetch('https://ggcstolnadkkqhsqpzql.supabase.co/functions/v1/NOMBRE-FUNCION', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
  body: JSON.stringify({ cliente_id: 'UUID', mes: '2026-08' })
});
console.log(JSON.stringify(await r.json(), null, 2));
```

`pull-posts` y `pull-ads` aceptan `debug: true` para diagnóstico sin escribir
en la base.
