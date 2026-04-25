// ============================================================
// sw.js — Service Worker básico para Elegance Panel PWA
// Permite instalación como app en Android/iOS
// ============================================================

const CACHE_NAME = 'elegance-panel-v1';

// Archivos a guardar en caché para uso offline básico
const ARCHIVOS_CACHE = [
  '/',
  '/index.html',
  '/panel.js',
  '/tema.css',
];

// Instalación — guarda archivos en caché
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ARCHIVOS_CACHE))
      .catch(() => {}) // Si falla el caché, continuar igual
  );
  self.skipWaiting();
});

// Activación — limpia cachés viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch — red primero, caché como respaldo
self.addEventListener('fetch', event => {
  // Las llamadas al API siempre van a la red (nunca caché)
  if (event.request.url.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Guardar respuesta fresca en caché
        const copia = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copia));
        return response;
      })
      .catch(() =>
        // Sin red → usar caché
        caches.match(event.request)
      )
  );
});