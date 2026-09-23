/* Service worker – UGTM Souss-Massa
   - Réseau d'abord : les communiqués modifiés apparaissent dès qu'il y a de la connexion.
   - Sans connexion : la dernière version en cache s'ouvre quand même.
   Si vous changez ce fichier ou l'application, augmentez le numéro de version ci-dessous. */
var VERSION = 'ugtm-v2';
var SHELL = [
  './',
  'index.html',
  'data.js',
  'cloud.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function store(req, res) {
  if (res && (res.ok || res.type === 'opaque')) {
    var copy = res.clone();
    caches.open(VERSION).then(function (c) { c.put(req, copy); });
  }
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then(function (res) { return store(req, res); }).catch(function () {
        return caches.match(req).then(function (r) { return r || caches.match('index.html'); });
      })
    );
    return;
  }

  var isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  var isFirebaseLib = url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0;
  if (isFont || isFirebaseLib) {
    e.respondWith(
      caches.match(req).then(function (r) { return r || fetch(req).then(function (res) { return store(req, res); }); })
    );
  }
});
