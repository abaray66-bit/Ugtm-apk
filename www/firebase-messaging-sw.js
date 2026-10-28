// Service worker minimal pour Firebase Cloud Messaging (background).
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

try {
  self.importScripts('/data.js');
} catch(e) {}

var firebaseConfig = (self.APP_DATA && self.APP_DATA.firebase) ? self.APP_DATA.firebase : {
  apiKey: 'REPLACE_WITH_FIREBASE_API_KEY',
  authDomain: 'REPLACE_WITH_FIREBASE_AUTH_DOMAIN',
  projectId: 'REPLACE_WITH_FIREBASE_PROJECT_ID',
  storageBucket: 'REPLACE_WITH_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'REPLACE_WITH_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'REPLACE_WITH_FIREBASE_APP_ID'
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload){
  var title = (payload.notification && payload.notification.title) || 'UGTM';
  var body = (payload.notification && payload.notification.body) || '';
  self.registration.showNotification(title, { body: body, icon: '/icons/ugtm-mark.svg' });
});
