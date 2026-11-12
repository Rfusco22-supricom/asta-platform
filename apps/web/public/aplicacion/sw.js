/**
 * Service worker de la aplicación ASTA web (`/aplicacion/inicio`).
 *
 * Solo para que la aplicación ABRA sin red: si la tienda se queda sin internet
 * y alguien recarga o reinicia la tablet, la página sale de aquí en vez de la
 * pantalla de error del navegador. Los datos (búsquedas y compatibles) los
 * guarda la propia aplicación en `localStorage`, con su fecha.
 *
 *   · La página: primero la red; sin red, la última guardada.
 *   · El código y las letras de Next (`/_next/static`, con hash en el nombre):
 *     de la caché si están; si no, de la red, y se guardan.
 *   · La API (`/api/…`): nunca se guarda aquí.
 *
 * Su alcance es la carpeta `/aplicacion/`, el mismo que el del manifiesto.
 */

const VERSION = 'asta-app-v2';
const PAGINA = '/aplicacion/inicio';
const FIJOS = ['/aplicacion/manifest.webmanifest', '/aplicacion/icono-192.png', '/aplicacion/icono-512.png', '/aplicacion/logo.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll([PAGINA, ...FIJOS]))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // La página: red primero, y se guarda la última que llegó bien.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok) {
            const copia = r.clone();
            caches.open(VERSION).then((c) => c.put(PAGINA, copia));
          }
          return r;
        })
        .catch(() => caches.match(PAGINA).then((r) => r ?? Response.error())),
    );
    return;
  }

  // Lo de Next con hash, y los fijos de la aplicación: caché primero.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/aplicacion/')) {
    e.respondWith(
      caches.match(req).then(
        (guardado) =>
          guardado ??
          fetch(req).then((r) => {
            if (r.ok) {
              const copia = r.clone();
              caches.open(VERSION).then((c) => c.put(req, copia));
            }
            return r;
          }),
      ),
    );
  }
});
