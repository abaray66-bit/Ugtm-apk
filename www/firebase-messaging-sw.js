// Service worker minimal pour Firebase Cloud Messaging (background).
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
  var data = payload.data || {};
  var notification = payload.notification || {};
  var title = notification.title || data.title || 'UGTM';
  var body = notification.body || data.body || '';
  var tag = data.tag || data.targetId || data.notificationId || data.newsId || title;
  var targetUrl = data.targetUrl || data.url;
  if(!targetUrl){
    var base = 'https://ugtm-fns-souss-massa.web.app/app.html';
    try {
      var url = new URL(base);
      if(data.targetType === 'news' && data.targetId){
        url.searchParams.set('targetType','news');
        url.searchParams.set('targetId',data.targetId);
      } else if(data.newsId){
        url.searchParams.set('targetType','news');
        url.searchParams.set('targetId',data.newsId);
      } else if(data.targetType && data.targetId){
        url.searchParams.set('targetType',data.targetType);
        url.searchParams.set('targetId',data.targetId);
      }
      targetUrl = url.href;
    } catch(e){}
  }
  var options = {
    body: body,
    icon: '/icons/ugtm-mark.svg',
    badge: '/icons/ugtm-mark.svg',
    tag: String(tag),
    renotify: false,
    data: {
      url: targetUrl,
      targetType: data.targetType,
      targetId: data.targetId,
      notificationId: data.notificationId
    }
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var data = event.notification.data || {};
  var url = data.url || 'https://ugtm-fns-souss-massa.web.app/app.html';
  event.waitUntil(
    clients.matchAll({type: 'window', includeUncontrolled: true}).then(function(clientList){
      for(var i=0; i<clientList.length; i++){
        var client = clientList[i];
        if(client.url.indexOf('app.html') !== -1 && 'focus' in client){
          try { client.navigate(url); } catch(e){}
          return client.focus();
        }
      }
      if(clients.openWindow){
        return clients.openWindow(url);
      }
    })
  );
});
