# Pendientes de seguridad · Panel Studio Delfi

Cosas a revisar/mejorar más adelante (no urgente para el mockup, sí antes de
ponerlo en manos de clientes reales o venderlo a otras agencias).

> **Estado al 19/06/2026:** el grueso del modelo de permisos quedó cerrado.
> Lo que sigue pendiente está marcado abajo con 🔲. Lo hecho, con ✅.
>
> **Actualización 16/08/2026:** entró el panel interno (`interno.html`) y se
> cerró la Parte B (visibilidad de tareas internas). Ver sección 9.
> Queda un pendiente menor, marcado ahí.
>
> **Actualización 19/08/2026:** entró el Resumen de proyecto (Parte 8) con los
> "accesos" tapados y su registro de quién los mira. Ver la sección Parte 8.
> Más tarde ese mismo día entró el texto con links y emojis (Parte 9): ahí está
> la regla que hay que respetar cuando el panel del cliente muestre
> descripciones reales. Y a la noche, Equipo/Clientes/Wiki (Parte 10), que
> **cambia dos funciones de permisos que ya estaban en uso**: leer esa sección
> antes de tocar nada de roles.
>
> **Actualización 12/09/2026:** entró todo el reporte automático de Meta
> (posts, pauta, detalle por anuncio, cron diario). **Cambia dónde vive la
> service_role key** — ver sección 2, que quedó desactualizada — y suma tres
> superficies nuevas. Todo en la sección 13.

---

## 1. Anon key pública (lo que marcó Delfi)
- La `anon key` está a la vista en el front. **Eso es normal y por diseño**:
  va en el navegador, no es un secreto. Lo que protege los datos es la **RLS**.
- ✅ **RLS confirmada activa en las 13 tablas** (chequeado en `pg_class`):
  `acceso_cliente, agencia, archivo, clientes, comentario_tarea, evo_metrica,
  idea, ig_integracion, ig_media, post, profiles, reporte, tarea`.
- ✅ Las 3 tablas nuevas del panel interno (`subtarea`, `adjunto_tarea`,
  `actividad_tarea`) nacen con RLS prendida en la propia migración.
- 🔲 Regla a mantener: **cada tabla nueva, prenderle RLS** y darle policies
  antes de usarla. Una tabla con RLS apagada = abierta con la anon key pública.

## 2. service_role key
- ✅ No aparece en el front.
- ⚠️ **Desde el 12/09/2026 ya no es cierto que "solo la inyecta Supabase sola".**
  Además de las edge functions, ahora vive **en Vault** (`service_role_key`) y
  la lee `sync_diario()` para firmar las llamadas del cron. Es el patrón que
  documenta Supabase y sigue siendo server-side, pero es una superficie más:
  - La función es `security definer` y tiene `revoke execute` a `anon` y
    `authenticated`. Sin eso, cualquier usuario logueado podía dispararla.
  - La clave pasó **una vez** por el SQL Editor del dashboard al cargarla. No
    va en ninguna migración: una service_role key en el repo es una service
    role key en GitHub.
  - 🔲 Si alguna vez se rota la clave, hay que actualizarla en Vault también,
    no solo en las funciones.

## 3. Políticas de escritura
- ✅ Ya no hay solo SELECT. Tienen INSERT/UPDATE/DELETE acotados:
  - `clientes`: insert/update solo `es_super()` o agencia de su propia agencia
    (`agencia = mi_agencia()`). Delete alineado a lo mismo.
  - `acceso_cliente`: insert/delete por `es_agencia()`.
  - `idea`: cliente inserta; edita/borra solo las propias; agencia todo.
  - `comentario_tarea`: ambos insertan; borran lo propio; agencia todo.
    Contador `tarea.comentarios` lo mantiene un trigger (`sync_tarea_comentarios`).

## 4. Endurecimiento de `profiles` (escalada de privilegios) ✅
- **Problema que había:** `profiles_update = es_agencia()` dejaba a cualquier
  usuario de agencia cambiar `tipo`, `super_admin` o `agencia` de un perfil
  (la RLS es por fila, no por columna). De ahí salen TODOS los permisos.
- **Cerrado con:** trigger `proteger_columnas_perfil` (BEFORE UPDATE) que
  rechaza cambios en esas 3 columnas salvo super-admin o contexto de servidor.
  Policy de update reescrita a `id = auth.uid() OR es_agencia() OR es_super()`.
- Resultado: cada uno edita su propio perfil (nombre, etc.), nadie se
  auto-promueve a super ni cambia roles ajenos.

## 5. Alta de usuarios — Edge Function `bright-handler` ✅
- La crea del lado servidor. Reglas que valida (no confía en el front):
  - Valida el JWT del que llama y carga su perfil real.
  - Solo agencia o super pueden invitar.
  - Agencia común: solo crea `tipo='cliente'`, con la agencia forzada a la
    suya, y solo puede asignar clientes que ella atiende.
  - Crear usuarios de agencia y cualquier super: **solo super**.
  - Nunca crea super-admin por acá; nunca loguea la contraseña.

## 6. `pull-instagram` — chequeo multi-tenant ✅
- Antes validaba "¿es agencia/super?" pero operaba sobre cualquier `cliente_id`.
- Ahora, si no es super, verifica que tenga acceso al cliente en
  `acceso_cliente` antes de bajar métricas.

## 7. Ajustes de Auth en Supabase — revisado el 12/09/2026
- ❌ **Leaked password protection: NO se puede.** Es una función de plan Pro en
  adelante. En Free el toggle existe pero al guardar devuelve
  "Failed to update auth configuration". No volver a intentarlo hasta que el
  proyecto esté en un plan pago.
- ✅ Lo que sí está puesto y es más estricto que el default de Supabase:
  mínimo **12 caracteres** (recomiendan 8) y exige minúsculas, mayúsculas,
  dígitos y símbolos.
- ✅ **Secure password change** y **Require current password when updating**
  prendidos el 12/09. Cierran el mismo agujero por dos caminos: una sesión
  abierta en una computadora ajena ya no alcanza para cambiar la contraseña y
  quedarse con la cuenta.
- 🔲 Captcha: apagado a propósito. Prenderlo sin configurar antes hCaptcha o
  Turnstile rompe el login.
- 🔲 Rate limiting de intentos: hay una sección (Auth → Rate Limits) que no se
  revisó.
- Nota: `bright-handler` usa `email_confirm: true` (el invitado entra sin
  verificar mail). Es a propósito para el alta por invitación; si en algún
  momento se abre registro público, repensar esto.

## 8. Multi-tenant (cuando entren otras agencias) 🔲 PARCIAL
- Las policies ya enfuerzan que la Agencia B no vea nada de la Agencia A
  (`mi_agencia()` en clientes; `acceso_cliente` en `puede_ver_cliente`).
- Falta **probarlo end-to-end** con una segunda agencia real antes de vender
  el panel a otra agencia.

---

## 9. Panel interno (`interno.html`) — agosto 2026

### Qué se agregó
- Columnas nuevas en `tarea`: `responsable_id`, `vence`, `orden`,
  `visible_cliente`, `completada_en`, `creado_por`, `actualizado_en`.
- `tarea.cliente_id` y `comentario_tarea.cliente_id` pasaron a **nullable**
  (las tareas internas de la agencia no cuelgan de ningún cliente).
- Tablas nuevas: `subtarea`, `adjunto_tarea`, `actividad_tarea`.
- Trigger `log_actividad_tarea` (SECURITY DEFINER) que escribe el historial.
- Parte 3: columna `tarea.empieza` (fecha de inicio) + trigger
  `ordenar_fechas_tarea` que da vuelta inicio y fin si vienen al revés.
  No agrega tablas ni cambia permisos: la vista calendario lee y escribe
  `empieza`/`vence` con las mismas policies `tarea_interno_*` de la Parte A.

### Lo que está resuelto ✅
- Guard de rol en el front: `interno.html` rebota a `panel-comakers.html` a
  cualquier perfil que no sea `tipo='agencia'` o `super_admin`. El login
  bifurca por tipo. **Ojo: esto es comodidad, no seguridad** — lo que
  realmente protege es la RLS de abajo.
- Policies `tarea_interno_*`: la agencia ve/edita las tareas sin cliente y las
  de los clientes que atiende; el super ve todo.
- `subtarea`, `adjunto_tarea` y `actividad_tarea` exigen las dos condiciones a
  la vez: ser perfil de agencia **y** poder ver la tarea madre (el
  `exists (select 1 from tarea …)` pasa por la RLS de `tarea`). Un usuario
  cliente no las toca nunca, aunque la tarea sea visible para él.
- `actividad_tarea` no tiene policy de INSERT desde el front: la escribe
  únicamente el trigger. El historial no se puede falsear desde el navegador.

### ✅ CERRADO — visibilidad de tareas internas para el cliente (16/08/2026)
- **El problema que había:** el dump de `pg_policies` confirmó que
  `tarea_select` y `comentario_select` (ambas `{public}`) filtraban solo por
  `puede_ver_cliente(cliente_id)` y nunca miraban `visible_cliente`. Como las
  policies permisivas se suman con OR, el flag no alcanzaba: un usuario
  cliente podía leer vía API las tareas internas con su `cliente_id` asignado
  y sus comentarios.
- **Cerrado con** `migracion-interno-4-parteB.sql`, que **reescribe** (no
  agrega) esas dos policies:
  - `tarea_select`: `puede_ver_cliente(cliente_id) AND (es_agencia() OR
    es_super() OR visible_cliente = true)`.
  - `comentario_select`: lo mismo, más un `exists` sobre `tarea` que hereda
    la RLS de arriba — si no ves la tarea, no ves su conversación.
- La agencia y el super no pierden nada: el panel interno sigue igual.

### ✅ CERRADO el 27/08/2026 (parte 31) — era un menor que quedó abierto 11 días
- `comentario_insert` ({public}) validaba `puede_ver_cliente(cliente_id)` pero
  no exigía que la tarea fuera visible para quien comenta. Un usuario cliente
  que adivinara el UUID de una tarea interna de su cliente podía insertarle un
  comentario — no podía leerlo después, ni leer la tarea. Ruido molesto, no
  fuga de datos. Cerrado con `puede_ver_tarea(tarea_id)` en el `with check`.

### ⚠️ Parte 7 — multi-proyecto rompe la privacidad (por diseño, decidido a conciencia)
- Desde la parte 7 una tarea puede vivir en varios proyectos (`tarea_proyecto`).
- La regla de visibilidad pasó a ser la de Asana, en `puede_ver_tarea()`:
  **ves la tarea si tenés acceso a AL MENOS UNO de sus proyectos.**
- **Consecuencia real, probada:** si una tarea de un proyecto privado se agrega
  también a uno público, deja de estar escondida para los no miembros. El panel
  pide confirmación antes de hacerlo y muestra un aviso permanente en el drawer,
  pero la base **no lo impide**.
- Si algún día hace falta cerrarlo, la alternativa es exigir acceso a **todos**
  los proyectos de la tarea (más seguro, pero rompe el caso de uso).
- Tablas nuevas con RLS prendida: `seccion`, `tarea_proyecto` (ambas cuelgan de
  `puede_ver_proyecto`).

### 🐞 Bug de RLS resuelto (19/08/2026) — policy que se lee a sí misma
- **Síntoma:** al crear un proyecto desde el panel, `ERROR 42501: new row
  violates row-level security policy for table "proyecto"`. Las tareas se
  creaban bien; los proyectos, nunca.
- **Causa:** el panel hace `INSERT ... RETURNING id` (necesita el id para
  guardar los miembros). Postgres aplica la policy de **SELECT** a la fila
  devuelta, y `proyecto_select` llamaba a `puede_ver_proyecto(id)`, que es
  `STABLE` y va a buscar la fila **a la misma tabla**. Con el snapshot previo
  al insert la fila todavía no existe → `false` → rechazo. El mensaje de
  Postgres es engañoso: parece un problema de permisos y es una policy
  recursiva.
- **Corregido en** `fix-policy-proyecto.sql`: `proyecto_select` (y `update` y
  `delete`) ahora evalúan la privacidad con las columnas de la propia fila
  (`privado`, `creado_por`) en vez de releerla. La regla de privacidad es
  idéntica; solo cambia cómo se calcula.
- ⚠️ **`migracion-interno-5-proyectos.sql` todavía tiene la versión con el
  bug.** Si alguna vez se vuelve a correr esa migración entera, hay que correr
  `fix-policy-proyecto.sql` después.

### Regla para las próximas migraciones
- Una policy de SELECT **nunca** debe llamar a una función que vuelva a leer
  la misma tabla que está protegiendo. Si hace falta, usar las columnas de la
  fila. Las funciones tipo `puede_ver_*` sí sirven para proteger **otras**
  tablas (`seccion`, `tarea_proyecto`, `tarea` las usan sin problema, porque
  ahí la fila del proyecto ya existe).
- Toda migración que toque policies tiene que venir con una prueba que
  impersone a un usuario real (`set_config('request.jwt.claims', …)` +
  `set local role authenticated`) y haga la escritura de verdad, incluido el
  `INSERT ... RETURNING`. Las pruebas del panel corren contra una base
  simulada en el navegador y **no** reproducen cómo Postgres evalúa la RLS:
  no sirven para esto.
- ⚠️ **Una migración tampoco puede LLAMAR a una función que exija estar
  logueada.** (28/08/2026) La parte 35 no corría: su paso de confirmación
  llamaba a `que_cuelga_del_cliente()`, que pide `es_socia()`. En el editor
  SQL **no hay usuaria logueada** —`auth.uid()` es null— así que la función
  cortaba con "Solo una socia puede ver esto", y como el editor envuelve todo
  en una transacción, ese error **deshizo también los `create function` de
  arriba**. No quedó nada creado. Es el mismo efecto que un `rollback`, por
  otro camino. La confirmación tiene que contar sola, sin pasar por funciones
  guardadas.
- ⚠️ **Ninguna migración puede terminar en `rollback`.** El editor SQL de
  Supabase envuelve todo el script en una sola transacción, así que un
  `rollback` puesto para limpiar una prueba también deshace el `create` o el
  `alter` de más arriba — y el script igual muestra "Success". Esto ya pasó
  con `fix-policy-proyecto.sql`: dio verde y no había cambiado nada. Por eso
  la prueba va en un **archivo aparte** (`prueba-resumen.sql` es el modelo) y
  limpia con `delete` explícitos, no con `rollback`.

### Parte 8 — el Resumen del proyecto (19/08/2026)
- Tablas nuevas, todas con RLS prendida y colgadas de `puede_ver_proyecto()`:
  `proyecto_dato`, `proyecto_link`, `dato_visto`. Columnas nuevas en
  `proyecto`: `descripcion` y `salud`.
- Acá `puede_ver_proyecto()` **sí** se puede usar: protege tablas distintas de
  `proyecto`, así que cuando se evalúa la fila del proyecto ya existe. El bug
  de la policy recursiva era solo cuando la tabla protegida y la consultada
  eran la misma.
- 🔲 **Los "accesos" (`es_secreto`) se guardan en texto plano.** El panel los
  muestra tapados y pide un click para revelarlos, pero el valor viaja al
  navegador igual: cualquiera del equipo con acceso al panel puede verlos.
  Sirve contra el descuido (pantalla compartida, captura, alguien mirando por
  encima del hombro), **no** contra alguien decidido. No guardar ahí nada que
  no querrías que vea todo el equipo. Si algún día hace falta de verdad,
  la solución no es cifrar en el front (la clave viajaría igual): es un
  gestor de contraseñas aparte con permisos propios.
- ✅ Cada vez que alguien revela o copia un acceso queda asentado en
  `dato_visto`. La tabla **no tiene policy de update ni de delete**, así que
  el registro no se puede editar ni borrar desde el panel.
- ✅ El registro **no cuelga del dato**: guarda `proyecto_id` y una copia de la
  etiqueta, y `dato_id` queda en `null` si el dato se borra. Si colgara del
  dato, bastaría con borrar el dato para borrar el rastro de quién lo vio.
- ✅ `dato_visto_insert` exige `user_id = auth.uid()`: nadie puede anotar un
  acceso a nombre de otra persona.
- Los proyectos privados siguen valiendo: los datos y links de un proyecto
  privado no le llegan a quien no es miembro (probado en `prueba-resumen.sql`
  y en `test-resumen.js`).

### Parte 9 — texto con links y emojis (19/08/2026)
- La descripción de las tareas, el brief del proyecto y los comentarios ahora
  muestran links clickeables. **No guardamos HTML escrito por el usuario.**
  Se guarda markdown mínimo en texto plano — `[palabra](url)` — y el panel lo
  convierte a HTML al mostrarlo.
- `renderTexto()` escapa **todo** primero con `esc()` y recién después
  reemplaza los patrones que reconoce. Consecuencias probadas en
  `test-texto.js` (grupo 5):
  - `<img src=x onerror=...>` y `<script>` quedan como texto, no generan
    ninguna etiqueta.
  - `[click](javascript:alert(1))` **no** genera link: el patrón exige
    `https?://`.
  - Una URL con comillas adentro no puede romper el atributo `href` ni sumar
    atributos: quedan solo `href`, `target` y `rel`.
- Todos los links salen con `target="_blank" rel="noopener noreferrer"`.
- 🔲 **Regla para el panel del cliente:** cuando `panel-comakers.html` muestre
  descripciones reales de la tabla `tarea`, tiene que usar la misma
  `renderTexto()`. Si alguien ahí hace `innerHTML = t.descripcion` a secas,
  reabre el agujero que este diseño evita.
- Los emojis son texto normal (las columnas son `text`, UTF-8): no cambia nada
  del modelo de datos.

### Parte 10 — Equipo, roles y bajas (19/08/2026)
- Columnas nuevas en `profiles`: `rol` ('socia' | 'equipo'), `activo`, `baja_en`,
  `invitado_por`.
- ⚠️ **Se redefinieron `es_agencia()` y `es_super()`** para que además exijan
  `activo`. Eran las funciones que usaban casi todas las policies viejas
  (tarea, comentario_tarea, subtarea, adjunto_tarea, actividad_tarea, proyecto,
  seccion, tarea_proyecto), así que la baja vale en todas de una sola vez sin
  reescribir una sola policy. **La definición anterior queda impresa en los
  `notice` del paso 0 de la migración 10** por si hay que volver atrás.
- ✅ Una baja es una baja de verdad: `prueba-equipo.sql` verifica que la persona
  dada de baja no puede leer `tarea` ni `proyecto` **ni siquiera con una sesión
  ya abierta**, y que al reactivarla vuelve a ver. Esconderla del panel sin
  cortarle la API habría sido seguridad de cartón.
- El control fino de quién cambia qué campo va en el trigger
  `guardia_profiles` (la RLS de Postgres no distingue columnas):
  cualquiera cambia su propio nombre; `rol`, `activo`, `tipo`, `super_admin`,
  `agencia` y `email` solo los toca una socia; una socia no puede cambiarse el
  rol ni darse de baja a sí misma; nunca puede quedar cero socias activas.
- El trigger **no se mete cuando `auth.uid()` es null** (editor SQL y Edge
  Function con service_role). Es a propósito: si no, la invitación no podría
  crear la ficha.
- 🔲 **Ocultar el módulo Equipo del menú no es seguridad.** Lo que protege es el
  trigger. `test-equipo.js` (grupo 1) prueba las dos cosas: que a alguien de
  `equipo` no le aparezca, y que si igual fuerza el UPDATE, la base lo rechace.
- Los nombres y mails de todo el equipo los sigue viendo todo el equipo: el
  panel los necesita para los selectores de responsable. Eso no cambió.

### Parte 10b — la Edge Function `invitar-equipo`
- Crear usuarios necesita la clave `service_role`, que puede todo y saltea la
  RLS. **Nunca puede estar en el navegador.** Por eso la invitación vive en una
  Edge Function, donde la clave es una variable de entorno de Supabase.
- Antes de crear nada, la función verifica (a) que haya una sesión válida y
  (b) que esa persona sea socia y esté activa, leyendo `profiles` con la
  service_role. Sin ese chequeo, cualquiera con la anon key —que es pública—
  podría crear usuarios de la agencia.
- 🔲 El SMTP que trae Supabase de fábrica está limitado a unos pocos mails por
  hora. Para invitar a más de dos o tres personas seguidas hay que configurar
  un SMTP propio en Authentication → Emails.
- 🔲 `URL_PANEL` es a dónde vuelve la persona después de poner su contraseña.
  Si no se configura, usa `https://comakers.com.ar/login-comakers.html`.

### Parte 10c — Clientes y Wiki
- `clientes` sumó `activo`: archivar un cliente lo saca de los selectores pero
  no borra nada. El nombre sigue resolviendo en las tareas y proyectos viejos.
- La wiki (`wiki_carpeta`, `wiki_pagina`) la lee y la escribe **todo el equipo**,
  sin excepción. 🔲 **No es lugar para contraseñas ni datos sensibles**: para eso
  están los "accesos" del Resumen, que van tapados y dejan registro de quién los
  mira. La wiki no tiene ninguna de las dos cosas.
- El contenido de la wiki usa la misma `renderTexto()` de la Parte 9, así que
  vale la misma garantía: no se guarda HTML del usuario.

### Parte 11 — bandeja, colaboradoras y menciones (21/08/2026)
- Tablas nuevas: `tarea_colaborador` (quién sigue cada tarea) y `novedad`
  (la bandeja de cada persona).
- ✅ **`novedad` no tiene policy de INSERT.** Las novedades las escriben solo
  los disparadores, que son `SECURITY DEFINER`. Desde el navegador nadie puede
  inventarle una novedad a otra persona — probado en `prueba-bandeja.sql` (D1).
- ✅ **La bandeja es estrictamente personal:** `novedad_select` exige
  `user_id = auth.uid()`. Ni una socia ve la bandeja de otra. Es a propósito:
  ahí adentro hay fragmentos de comentarios que pueden ser de proyectos
  privados. Probado en E1.
- ✅ Las novedades **respetan las bajas**: los disparadores filtran por
  `tipo = 'agencia' and coalesce(activo, true)`, así que a alguien dada de baja
  no le entra nada nuevo (probado en F).
- Las menciones se guardan como `@[Nombre](uuid)` en texto plano, igual que los
  links de la Parte 9. `renderTexto()` las convierte en un chip **antes** de
  procesar links, y el patrón excluye `http(s)` para no comerse una URL. Sigue
  sin guardarse HTML del usuario.
- 🔲 **El fragmento del comentario viaja a la bandeja.** `novedad.detalle`
  guarda los primeros 140 caracteres del comentario. Si alguien comenta algo
  sensible en una tarea de un proyecto privado y menciona a una persona que no
  es miembro de ese proyecto, esa persona **recibe ese fragmento** aunque no
  pueda abrir la tarea. Es el precio de que las menciones funcionen. Si algún
  día molesta, la solución es no copiar el texto y mostrar solo "te mencionó".
- Colaborar es enterarse, no ser dueña: `tarea_colaborador` no toca
  `responsable_id` y la vista "Mías" sigue contando solo la responsable.

### Parte 12 — la bandeja no puede repetir (23/08/2026)
- **Qué pasaba:** la prueba de la parte 11 marcó que asignar dejaba 2 novedades
  y una mención 6. Causa confirmada: `sync_tarea_comentarios()` **actualiza
  `tarea`** en cada comentario (mantiene el contador), y eso volvía a disparar
  `novedades_tarea_tg`. Sobre `tarea` conviven cuatro disparadores; cualquiera
  que la escriba re-dispara a los demás.
- **Cómo se arregló, y por qué así:** además de cortar temprano en el trigger
  cuando el update no cambia nada que se avise, se agregó un **índice único**
  `novedad_sin_repetir` sobre (persona, tarea, tipo, actor, minuto en UTC), y
  los disparadores insertan con `on conflict do nothing`.
  La diferencia importa: cortar el trigger arregla *este* caso; el índice hace
  que el problema **no pueda volver a existir** aunque mañana alguien agregue
  otro disparador sobre `tarea`. Eso es idempotencia y debería haber estado
  desde la parte 11.
- El minuto se calcula con `timezone('UTC', created_at)` a propósito: con la
  zona de la sesión la expresión no sería inmutable y Postgres rechazaría el
  índice.
- 🔲 **Regla para lo que venga:** cualquier disparador que escriba en una tabla
  que ya tiene otros disparadores encima tiene que ser idempotente. En esta
  base, `tarea` es la más poblada: cuatro triggers, uno de ellos la actualiza
  a sí misma.

### Recuperar contraseña (23/08/2026)
- ✅ **Las contraseñas no se pueden ver.** Supabase guarda un hash en
  `auth.users.encrypted_password`, no la contraseña. Ni Delfi, que es dueña del
  proyecto, puede leerla. Si alguna vez hiciera falta "ver" una, la respuesta
  correcta es siempre reemplazarla, nunca recuperarla.
- `login-comakers.html` no tenía "¿Olvidaste tu contraseña?", así que cada olvido
  obligaba a entrar a Supabase. Ahora el login manda el mail solo
  (`resetPasswordForEmail`) y, al volver del link, muestra el formulario para
  poner una nueva.
- ✅ **El aviso es el mismo exista o no la cuenta.** Si dijera "ese mail no está
  registrado", cualquiera podría averiguar quién tiene cuenta probando
  direcciones. Es un detalle chico que se pasa por alto seguido.
- El link de recuperación llega en el `#` de la URL. La página detecta
  `type=recovery` y **no entra al panel**: si entrara, alguien con el link
  entraría sin poner contraseña nueva.
- 🔲 Sigue valiendo el límite de mails del SMTP de Supabase: si no llega en unos
  minutos, es eso. Para uso real conviene un SMTP propio.

### Nota de diseño (no es un bug)
- `interno.html` no está "escondido" en una URL rara a propósito: esconder la
  URL no protege nada. Cualquiera puede pedirla; lo que decide qué ve es la
  RLS y el guard de rol.

---

## 11. Repaso de permisos de punta a punta — 26/08/2026 (partes 19 a 25)

Arrancó porque **Marti y Lari veían 4 de 21 clientes** y Delfi los 21. Terminó
en un repaso completo. Lo que hay que recordar de acá:

### La regla que hay que grabarse: son DOS puertas
En Postgres el acceso a una tabla pasa por dos controles distintos, y hay que
mirar los dos:

1. **GRANT** — ¿este rol puede tocar la tabla, para algo?
2. **RLS** — de las filas de esa tabla, ¿cuáles?

Si falta el GRANT, la consulta muere con `permission denied for table …`
**antes** de que la RLS opine. Las auditorías 20, 21 y 22 leían solo policies y
RLS: una auditoría que mira una sola puerta puede decir "está todo bien" y
estar mirando la mitad. La 25 chequea `has_table_privilege` para las 31 tablas.

En esta base los GRANT estaban bien igual (Supabase los da solos por *default
privileges*), pero las migraciones 5, 7 y 8 no tienen ni un `grant`: si alguna
vez se restaura en otro proyecto, ahí sí falta.

### Lo que estaba mal de verdad
- ✅ **`clientes` (parte 19).** Su policy de SELECT es la vieja del panel de
  cliente: `puede_ver_cliente(id)`, o sea "los que te asignaron". Delfi los veía
  todos por ser `super_admin`, no por ser socia. Se **sumó** una policy
  `clientes_select_agencia` con `es_equipo()`; la vieja no se tocó, así que un
  cliente sigue viendo solo lo suyo. Ídem `acceso_cliente`.
- ✅ **`persona_externa` (parte 21).** La creé en la 17 con `using (true)`.
  `true` incluye a los usuarios **cliente**: cualquiera con cuenta podía leer la
  lista de colaboradoras de la agencia. Cerrada a `es_equipo()`.
- ✅ **`tarea_dependencia` (parte 22).** La creé en la 18 pidiendo solo
  `puede_ver_tarea()`, sin exigir cuenta de agencia. Como esa función devuelve
  "sí" para una tarea sin proyecto, un cliente podía leer esas filas (dos uuid,
  sin títulos). Cerrada con `es_equipo()`.

### Lo que NO estaba mal (y yo dije que sí)
Anotado a propósito, para no volver a perseguirlo:
- **`profiles`** ya dejaba ver a todo el equipo de la misma agencia. La policy
  que agregué en la 20 es redundante.
- **`puede_ver_cliente(null)`** devuelve **no**. Nunca hubo fuga de comentarios
  internos hacia los clientes.
- **Todas** las funciones de permiso (`es_*`, `puede_ver_*`) son
  `security definer`. No había recursión de policies.
- **Los proyectos privados nunca estuvieron abiertos.** La auditoría de la 20
  los reportó como "todo el equipo" por un error MÍO al clasificar: buscaba
  `es_equipo` antes de fijarse si además filtraba por proyecto, y las policies
  dicen `es_equipo() AND (privado = false OR creado_por = … OR es miembro)`.
  La 21 lo remide bien y además **ejecuta** la regla proyecto por proyecto en
  vez de leerla.

### Lección de método (la más importante de todas)
Cinco rondas persiguiendo un problema de permisos que no existía, porque el
panel decía **"Falta correr migracion-interno-8"** ante *cualquier* error de esa
consulta — y encima dejaba el cartel prendido para el resto de la sesión.
Lo que realmente pasó: Delfi corría las migraciones 19 a 22, Supabase recargó su
caché de tablas, una consulta cayó justo en esa ventana.

- 🔲 **Regla para todo mensaje de error del panel:** no afirmar una causa que no
  se verificó. Si la tabla no existe → decir eso. Si es otra cosa → mostrar el
  texto que devolvió la base. Un mensaje seguro de sí mismo y equivocado cuesta
  más caro que no tener mensaje.
- ✅ Arreglado en `cargarResumen`: la bandera arranca en falso en cada carga y
  hay un reintento a los 400 ms. Un tropezón se resuelve solo; uno real avisa
  con el texto de la base.
- ✅ **27/08 · pasó de nuevo, y era esto mismo.** Al crear una subtarea el panel
  decía "falta correr migracion-interno-15" con la 15 corrida hace días.
  `cargarTareas()` marcaba `FALTA_M15` ante *cualquier* error de la consulta.
  Arreglado con un criterio único, `faltaDeVerdad(err)`: solo se culpa a una
  migración si el mensaje dice que la columna o la tabla **no existe**;
  cualquier otro error se reintenta una vez y, si persiste, se muestra tal cual.
- 🔲 Quedan con el mismo vicio: `avisoM14`, `avisoM16`, `avisoM17`, `FALTA_M10`.
  Pasarlos todos por `avisoFalta()`, que ya está escrito.

### Cambios de acceso deliberados de esta tanda
- **Wiki → solo socias** (parte 18, paso 5). Antes la leía todo el equipo.
  Decisión de Delfi. Se revierte cambiando las dos policies a `es_equipo()`.
- **Fichas sin cuenta** (`persona_externa`, parte 17): gente que cobra pero no
  entra al panel. **No puede** ser responsable de tarea ni ejecutora de
  servicio: esas columnas apuntan a `profiles` y no tendría dónde verlas.
- **Favoritos de proyecto** son por persona (`user_id = auth.uid()`), no
  compartidos.


---

## 12. Lo que cuelga de una tarea — 27/08/2026 (partes 28 a 31)

Arrancó con Marti sin poder crear una tarea con cliente. Terminó destapando
tres agujeros, **dos de ellos escritos por mí**, y uno que abrí ese mismo día
arreglando el anterior.

### Lo que estaba mal
- ✅ **`acceso_cliente` era una pared entre nosotras (parte 28).** Las policies
  internas de `tarea` pedían `puede_ver_cliente(cliente_id)`, o sea "estar
  asignada a ese cliente". Marti no podía crear la tarea de Ghio — y peor,
  **no la veía**, sin ningún error. La cuenta salió así: Ludmila veía 20 de 36
  tareas; Marti y Lari, 34 de 36. Se reemplazó por `cliente_de_mi_agencia()`
  **solo en el panel interno**; `tarea_select` (la del cliente) quedó intacta.
- ✅ **"No la ves, pero la podés borrar" (parte 29).** `tarea_interno_delete`,
  `tarea_update` y `tarea_delete` no pedían `puede_ver_tarea`. La pared de los
  proyectos privados estaba puesta en el SELECT y en ningún otro camino. Lo
  escribí yo en la migración 5.
- ✅ **Los comentarios de una tarea privada (parte 31).** Al ampliar
  `com_interno_select`/`_insert` en las partes 28 y 29 no les puse
  `puede_ver_tarea`. Durante un día cualquiera de la agencia pudo leer los
  comentarios de tareas de proyectos privados de los que no es miembro. Antes
  el filtro por cliente lo frenaba de casualidad.
- ✅ `comentario_delete` era `es_agencia() OR …`: cualquiera de la agencia
  borraba **cualquier** comentario, incluso ajeno y de una tarea que no ve.
  Ahora: hay que poder ver la tarea, y el comentario tiene que ser propio salvo
  que seas socia.
- ✅ `adjunto_tarea`, `subtarea` y `actividad_tarea` chequeaban con un
  `EXISTS (select 1 from tarea …)`. Probablemente alcanzaba, pero dependía de
  un detalle de Postgres imposible de verificar leyendo. Pasaron a decir
  `puede_ver_tarea(tarea_id)` explícito.

### 🔲 La regla que me faltaba, escrita
**Cuando se arregla un permiso hay que revisar los cuatro caminos — ver, crear,
editar, borrar — y todas las tablas que cuelgan de esa fila.** Las partes 28,
29 y 31 son tres tandas del mismo arreglo porque cada vez miré un camino solo.
De una tarea cuelgan siete tablas: `subtarea`, `adjunto_tarea`,
`comentario_tarea`, `actividad_tarea`, `tarea_colaborador`, `tarea_proyecto`,
`tarea_dependencia`.

Corolario que también se pagó caro: **ampliar un permiso es tan peligroso como
abrirlo**. Las tres veces el agujero apareció mientras *arreglaba* algo.

### 🔲 Mi propio clasificador se equivocó cuatro veces
Las auditorías 20, 21, 30 y una lectura de `cliente_modulo` reportaron como
rotas cosas que estaban bien. La última: el diagnóstico 30 marcó **todas** las
policies de `tarea` como "NO CHEQUEA" porque mi consulta buscaba una columna
`tarea_id` que `tarea` no tiene, y la clasificó como tabla de proyecto.
**Una auditoría automática que se equivoca es peor que ninguna**, porque
invita a "arreglar" lo que funciona. Toda auditoría nueva tiene que probarse
contra un caso conocido-bueno antes de creerle.

### 🔲 PENDIENTE — `visible_cliente` hoy no sirve para nada (medido el 27/08)
Desde que la migración 13 hizo privados **todos** los proyectos, un usuario
cliente no puede ver ninguna tarea que esté dentro de un proyecto: no es
miembro de ninguno, así que `puede_ver_tarea` le da que no — **aunque la tarea
esté marcada `visible_cliente`**.

**Medido en la 31: hay 0 tareas marcadas.** O sea que hoy no hay daño; el
flag simplemente nunca se usó. Pero es una mina: la primera vez que alguien
tilde "ve el cliente", la tarea **no** va a aparecer y no va a haber ningún
error que lo diga.

El fondo del asunto: un cliente **nunca** va a ser miembro de un proyecto, así
que `puede_ver_tarea` le va a dar que no siempre. La privacidad de proyecto es
una pared entre las del equipo, no entre la agencia y el cliente — para eso
está `puede_ver_cliente` + `visible_cliente`, que ya es un opt-in explícito
tarea por tarea.

**Arreglo recomendado (migración 32, sin escribir todavía):** en `tarea_select`
—la policy del cliente, y solo esa— decidir por `puede_ver_cliente(cliente_id)
AND visible_cliente`, sin pasar por `puede_ver_tarea`. Las policies internas no
se tocan: entre las del equipo la privacidad de proyecto sigue mandando igual.

**Decidido el 27/08: se sacó el control del panel, no el dato.** Delfi eligió
esconder el tilde hasta que el panel del cliente se cablee de verdad. Estado:

- ❌ Fuera del panel: el switch del modal de tarea, el switch del drawer, el
  ojito en las tarjetas y en las filas. El campo **ya no viaja** en ningún
  insert ni update.
- ✅ Intacto: la columna `tarea.visible_cliente`, sus policies, y la línea del
  historial (`case 'visible_cliente'`) por si hay actividad vieja que mostrar.
- ✅ `test-interno.js` (grupo 3) verifica que no quedó ningún resto: cuenta que
  `#fVisible`, `#dVisible` y `.ojo` sean 0 y que ninguna tarea creada lleve el
  campo. Si alguien lo devuelve sin arreglar la policy, el test avisa.

Cuando se retome: correr la 32 **primero**, y recién después devolver el
switch. Al revés se vuelve a la misma mina.

---

## Nota aparte (NO es seguridad, pero ojo antes de producción)
- El **Resumen** muestra "Highlights del mes" y "Mis pendientes" **hardcodeados
  en el HTML** — un cliente real vería datos inventados como propios. Las cards
  de arriba (Alcance/Engagement/Conversiones/Inversión) sí salen de `reporte`.
  Cablear o sacar los highlights/pendientes antes de abrirle el panel a un
  cliente de verdad.
- Las tareas de `panel-comakers.html` siguen hardcodeadas en el HTML. Cuando
  las cablees a la tabla `tarea`, filtrar por `visible_cliente = true`.

---

## 13. Reporte automático de Meta — 12/09/2026

Un día entero. Entraron los posts de Instagram, la pauta, el detalle por
anuncio, el cron diario y el análisis con IA. Tres superficies nuevas.

### Tablas nuevas — RLS puesta en la propia migración ✅
- `post_instagram` — posts de IG con sus métricas.
- `anuncio_meta` — un anuncio por mes, con inversión y costo por resultado.

Las dos con el patrón de siempre: `profiles.super_admin` o `acceso_cliente`,
más una policy de agencia con `es_agencia() AND cliente_de_mi_agencia()`.
Se cumplió la regla del punto 1 (toda tabla nueva nace con RLS).

🔲 **Pendiente fácil:** en Database → Policies hay un botón "Set up trigger"
que prende RLS automáticamente en cada tabla nueva. Hoy se viene cumpliendo a
mano en cada migración; ese trigger lo vuelve imposible de olvidar.

### Bucket privado `post-thumbs` ⚠️ SIN AUDITAR
- Guarda las miniaturas de posts (`{cliente_id}/{media_id}.jpg`) y de anuncios
  (`ads/{cliente_id}/{ad_id}.jpg`). Las URLs que da Meta vencen en horas; el
  archivo del bucket no.
- El panel las muestra con `createSignedUrls(rutas, 3600)`.
- 🔲 **Nunca se leyeron las policies de storage de ese bucket.** Funciona, o
  sea que algo deja firmar, pero no se verificó **quién** puede firmar qué. La
  pregunta concreta: ¿puede un usuario del cliente A firmar una ruta del
  cliente B si adivina el UUID? La ruta lleva el `cliente_id` adentro, así que
  es adivinable. **Revisar antes de que haya dos clientes con acceso real.**

### Token de Meta — permisos de más ⚠️
- `comakers-panelbot` tiene `ads_management` cuando solo necesita
  `ads_read`. Deuda vieja, anotada desde el principio.
- 🔲 **Nuevo el 12/09:** se le dio **acceso total** a la cuenta publicitaria
  FOS GI (`483803057555648`) cuando con "Ver rendimiento" alcanzaba. El panel
  nunca escribe en Meta: solo lee.
- Arreglo del segundo: Business Manager → Usuarios del sistema →
  comakers-panelbot → FOS GI → Administrar → bajar a Ver rendimiento.
- Arreglo del primero: generar un token nuevo sin `ads_management` y
  reemplazar el secret `META_TOKEN`. **Más delicado**: si el token nuevo sale
  mal, se caen los tres pulls a la vez. Hacerlo con tiempo y probando
  `meta-cuentas` antes de dar por bueno.

### Cron `pull-diario` ✅ con una salvedad
- Corre a las 06:00 UTC (03:00 AR) y dispara los pulls según qué módulo tenga
  prendido cada cliente.
- `sync_diario()` es `security definer` con `revoke execute` a `anon` y
  `authenticated` — ver sección 2.
- ⚠️ **El log del cron dice timeout y no es un error.** pg_net no espera a que
  la función termine. El registro que vale es
  `cliente_integracion.ultimo_sync` / `ultimo_error`.

### `cliente_modulo` pasó a ser la única verdad
- Antes había tres cosas decidiendo lo mismo: `clientes.rep_organico` /
  `rep_pauta`, esta tabla, y de hecho si había métricas cargadas.
- Ahora manda `cliente_modulo`. Las dos columnas viejas quedaron marcadas como
  OBSOLETAS con `comment on column`, pero **no se borraron**: si algo que no vi
  las usa, borrarlas rompería en silencio.
- 🔲 Buscar quién más lee `rep_organico` / `rep_pauta` y terminar de sacarlas.
  `pull-instagram` todavía lee `rep_pauta` para decidir si escribe `alcance`.

### El análisis con IA — primer componente con costo por uso
- `analizar-reporte` ahora ve: métricas de orgánico y pauta, las 5
  publicaciones de mayor alcance con su caption recortado, y los 5 anuncios de
  mayor inversión.
- Sigue siendo **a pedido** (botón), no automático. 🔲 Si algún día lo dispara
  el cron, decidir antes para qué clientes y con qué frecuencia: cada
  generación es una llamada paga a la API de Claude.
- Reglas del prompt que son de seguridad de datos, no de estilo:
  - **No sumar alcance orgánico + pauta.** Cuenta dos veces a las mismas
    personas. Es el error más fácil y el que más daño hace, porque el cliente
    repite el número inflado.
  - No atribuir causas, no recomendar mover presupuesto, no comprometer
    acciones de la agencia.
- ✅ Lo escrito a mano nunca se pisa: solo se regenera si
  `analisis_generado_en` tiene fecha (o sea, si el texto lo escribió Claude y
  nadie lo revisó).

### Lección de método del día
Un `create table if not exists` sobre una tabla que ya existía con otro
esquema no hace nada y no avisa: el error aparece recién en el índice
siguiente, apuntando a una columna que "no existe". **Los nombres genéricos
son una trampa** — `post` ya estaba tomado por el calendario editorial. De ahí
salieron `post_instagram` y `anuncio_meta` con sufijo.

Corolario que costó una hora: un `rm x && cp y` donde el `cp` falla **borra
igual**. Y si el archivo no estaba commiteado, no hay vuelta. Commitear antes
de mover archivos, siempre.
