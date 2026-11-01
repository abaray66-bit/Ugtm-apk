// Service worker FCM : un clic sur une notification ouvre la racine UGTM.
// Le gestionnaire est déclaré avant Firebase, comme recommandé par FCM.
const APP_ROOT_URL = 'https://ugtm-fns-souss-massa.web.app/app.html';

self.addEventListener('install', function(event){
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', function(event){
  event.waitUntil(self.clients.claim());
});

function notificationTargetUrl(data){
  var info=data||{};
  var root=new URL(APP_ROOT_URL);
  var raw=info.targetUrl||info.url||'';
  if(raw){
    try{
      var candidate=new URL(String(raw),APP_ROOT_URL);
      if(candidate.origin===root.origin&&candidate.pathname===root.pathname)return candidate.href;
    }catch(e){}
  }
  var type=String(info.notificationType||info.targetType||'');
  var id=String(info.notificationId||info.targetId||'');
  if((type==='news'||type==='event')&&/^[A-Za-z0-9_-]{1,150}$/.test(id)){
    root.searchParams.set('notificationType',type);
    root.searchParams.set('notificationId',id);
  }
  return root.href;
}

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var notificationData=event.notification.data||{};
  var fcmData=notificationData.FCM_MSG&&notificationData.FCM_MSG.data||{};
  var clickData=Object.assign({},fcmData,notificationData);
  // Rejeter l'ancien domaine Vercel, tout en gardant les liens de publication Firebase.
  var targetUrl = notificationTargetUrl(clickData);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList){
      try {
        var root = new URL(APP_ROOT_URL);
        // Avoid any Vercel destination
        try {
          var turl = new URL(targetUrl);
          if(turl.hostname.indexOf('vercel.app') !== -1){
            targetUrl = root.href + (turl.search || '');
          }
        } catch(e){}
        var appClient = clientList.find(function(client){
          try { return client.url.indexOf(root.origin + '/') === 0; } catch(e){ return false; }
        });
        if (appClient) {
          if (typeof appClient.navigate === 'function') {
            return appClient.navigate(targetUrl).then(function(client){
              return (client || appClient).focus();
            }).catch(function(){ return appClient.focus(); });
          }
          return appClient.focus();
        }
        return self.clients.openWindow(targetUrl);
      } catch(e){
        return self.clients.openWindow(APP_ROOT_URL);
      }
    })
  );
});

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyB-xhY-y5uuglA4ZUuXfM8FY5C6eTTZRMg',
  authDomain: 'ugtm-fns-souss-massa.web.app',
  projectId: 'ugtm-fns-souss-massa',
  storageBucket: 'ugtm-fns-souss-massa.appspot.com',
  messagingSenderId: '313270677240',
  appId: '1:313270677240:web:e93739d6533750b3dd150d'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload){
  // FCM affiche déjà les payloads « notification » en arrière-plan.
  // Les réafficher ici créait une seconde alerte pour le même sujet.
  if(payload&&payload.notification)return;
  var title = 'UGTM';
  var body = (payload.notification && payload.notification.body) || '';
  var notificationData=payload.data||{};
  self.registration.showNotification(title, { body: body, icon: '/icons/ugtm-mark.svg', data: { url: notificationTargetUrl(notificationData), targetType: notificationData.notificationType||'', targetId: notificationData.notificationId||'' } });
});
self.addEventListener('push', function(event){
  try {
    if(!event.data) return;
    var payload = {};
    try { payload = event.data.json(); } catch(e) { return; }
    var data = payload.data || {};
    var notification = payload.notification || {};
    // If notification payload present, FCM may show it; but ensure data has correct target
    if(!data.targetUrl && !data.notificationType){
      // try to build
    }
  } catch(e){}
});
