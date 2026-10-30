/* ═══════════════════════════════════════════════════════════════
   Service Worker de CoMakers

   Su ÚNICO trabajo es que el panel se pueda "instalar" en el celular.
   NO cachea la app para usarla offline, a propósito: el panel vive de
   datos en vivo de Supabase (reportes, tareas, clientes). Si guardáramos
   las páginas, un cliente podría abrir el reporte del mes pasado o una
   versión vieja del código después de un deploy. Preferimos que, sin
   internet, muestre una pantalla honesta de "sin conexión" antes que
   algo viejo y engañoso.

   Estrategia: RED PRIMERO siempre. Lo único que se guarda es la
   pantalla de respaldo y los íconos, para poder mostrarlos sin red.

   Cuando cambie algo de este archivo, subí el número de VERSION:
   eso borra el caché viejo y evita que el SW se quede "pegado".
   ═══════════════════════════════════════════════════════════════ */

const VERSION = 'v2';
const CACHE = `comakers-${VERSION}`;

// Lo mínimo para que la pantalla de respaldo se vea aunque no haya red.
const RESPALDO = [
  './offline.html',
  './icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(RESPALDO)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Solo GET. Todo lo demás (login, guardar, etc.) pasa de largo.
  if (req.method !== 'GET') return;

  // NUNCA tocar llamadas a Supabase ni a otros dominios (CDNs, fuentes,
  // APIs). Que vayan directo a la red: no son nuestras para cachear.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.hostname.includes('supabase')) return;

  // Navegación (abrir una página): red primero; si no hay red, respaldo.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./offline.html'))
    );
    return;
  }

  // Resto de archivos propios (íconos, manifest): red primero, y si no
  // hay red probamos el caché por si es algo del respaldo.
  e.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});

/* ── NOTIFICACIONES PUSH ─────────────────────────────────────────
   Llega un push (aunque la app esté cerrada) → mostramos la notificación.
   La Edge Function `enviar-push` manda un JSON { title, body, url, tag }. */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'CoMakers', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'CoMakers';
  e.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: d.tag || 'comakers',
      renotify: true,
      data: { url: d.url || 'interno.html' },
    })
  );
});

// Tocar la notificación → traer la app al frente (o abrirla) en la tarea.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = (e.notification.data && e.notification.data.url) || 'interno.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) { w.focus(); if ('navigate' in w) w.navigate(destino).catch(() => {}); return; }
      }
      return self.clients.openWindow(destino);
    })
  );
});
