// Service worker FCM : un clic sur une notification ouvre la racine UGTM.
// Le gestionnaire est déclaré avant Firebase, comme recommandé par FCM.
const APP_ROOT_URL = 'https://agile-marimba-ow7rjs2-abaray66-2380.vercel.app/www/';

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) || APP_ROOT_URL;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList){
      var appClient = clientList.find(function(client){
        return client.url.indexOf(new URL(APP_ROOT_URL).origin + '/www/') === 0;
      });
      if (appClient) {
        if (typeof appClient.navigate === 'function') {
          return appClient.navigate(targetUrl).then(function(client){
            return (client || appClient).focus();
          });
        }
        return appClient.focus();
      }
      return self.clients.openWindow(targetUrl);
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
  var title = (payload.notification && payload.notification.title) || 'UGTM';
  var body = (payload.notification && payload.notification.body) || '';
  self.registration.showNotification(title, { body: body, icon: '/www/icons/ugtm-mark.svg', data: { url: APP_ROOT_URL } });
});