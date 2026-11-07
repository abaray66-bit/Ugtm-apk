/* Service worker – UGTM Souss-Massa
   - Réseau d'abord : les communiqués modifiés apparaissent dès qu'il y a de la connexion.
   - Sans connexion : la dernière version en cache s'ouvre quand même.
   Si vous changez ce fichier ou l'application, augmentez le numéro de version ci-dessous. */
var VERSION = 'ugtm-v64';
var SHELL = [
  './',
  'index.html',
  'app.html',
  'data.js',
  'cloud.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/ugtm-mark.svg'
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
        return caches.match(req).then(function (r) { return r || caches.match('app.html'); });
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

/* ===============================================================
   Notifications push (Firebase Cloud Messaging)
   ---------------------------------------------------------------
   sw.js est désormais le SEUL service worker de l'application.
   Enregistrer aussi firebase-messaging-sw.js sur la même portée « / »
   faisait remplacer l'un par l'autre à chaque chargement : l'abonnement
   push était détruit et l'appareil devenait muet (FCM répondait ensuite
   « NotRegistered »). Le SDK FCM est donc chargé ici, et getToken reçoit
   cet enregistrement comme serviceWorkerRegistration.
   =============================================================== */

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

var APP_ROOT_URL = 'https://ugtm-fns-souss-massa.web.app/app.html';

function notificationTargetUrl(data){
  var info = data || {};
  var root = new URL(APP_ROOT_URL);
  var raw = info.targetUrl || info.url || '';
  if (raw) {
    try {
      var candidate = new URL(String(raw), APP_ROOT_URL);
      if (candidate.origin === root.origin && candidate.pathname === root.pathname) return candidate.href;
    } catch (e) {}
  }
  var type = String(info.notificationType || info.targetType || '');
  var id = String(info.notificationId || info.targetId || '');
  if ((type === 'news' || type === 'event') && /^[A-Za-z0-9_-]{1,150}$/.test(id)) {
    root.searchParams.set('notificationType', type);
    root.searchParams.set('notificationId', id);
  }
  return root.href;
}

firebase.initializeApp({
  apiKey: 'AIzaSyB-xhY-y5uuglA4ZUuXfM8FY5C6eTTZRMg',
  authDomain: 'ugtm-fns-souss-massa.web.app',
  projectId: 'ugtm-fns-souss-massa',
  storageBucket: 'ugtm-fns-souss-massa.appspot.com',
  messagingSenderId: '313270677240',
  appId: '1:313270677240:web:e93739d6533750b3dd150d'
});

var pushMessaging = firebase.messaging();

pushMessaging.onBackgroundMessage(function (payload) {
  // FCM affiche déjà les charges utiles « notification » en arrière-plan.
  // Les réafficher ici créait une seconde alerte pour le même sujet.
  if (payload && payload.notification) return;
  var data = (payload && payload.data) || {};
  self.registration.showNotification('UGTM', {
    body: String(data.body || ''),
    icon: '/icons/ugtm-mark.svg',
    data: { url: notificationTargetUrl(data) }
  });
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var notificationData = event.notification.data || {};
  var fcmData = (notificationData.FCM_MSG && notificationData.FCM_MSG.data) || {};
  var clickData = Object.assign({}, fcmData, notificationData);
  var targetUrl = notificationTargetUrl(clickData);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      try {
        var root = new URL(APP_ROOT_URL);
        try {
          var turl = new URL(targetUrl);
          if (turl.hostname.indexOf('vercel.app') !== -1) targetUrl = root.href + (turl.search || '');
        } catch (e) {}
        var appClient = clientList.find(function (client) {
          try { return client.url.indexOf(root.origin + '/') === 0; } catch (e) { return false; }
        });
        if (appClient) {
          if (typeof appClient.navigate === 'function') {
            return appClient.navigate(targetUrl).then(function (client) {
              return (client || appClient).focus();
            }).catch(function () { return appClient.focus(); });
          }
          return appClient.focus();
        }
        return self.clients.openWindow(targetUrl);
      } catch (e) {
        return self.clients.openWindow(APP_ROOT_URL);
      }
    })
  );
});
