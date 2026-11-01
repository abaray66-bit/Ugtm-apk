# PROCÉDURE DEBUG FCM - SANS EXPOSER SECRETS

## 1) Déterminer environnement
- Si app installée depuis APK (Capacitor) -> WebView Android
- Si ouverte dans navigateur Chrome -> PWA/Web
- Vérifier: window.Capacitor présent?

## 2) Récupérer logs sur appareil
### Android APK/WebView
- USB debug: chrome://inspect -> sélectionner WebView/app
- Ou adb logcat filtré par console/errors

### Chrome desktop
- DevTools Console + Network

## 3) Vérifications console (sans token)
Exécuter dans console:
```js
console.log('notif:', typeof Notification!=='undefined'?Notification.permission:'na');
console.log('sw:', 'serviceWorker' in navigator);
console.log('appData:', !!window.APP_DATA);
console.log('vapid:', !!(window.APP_DATA&&window.APP_DATA.firebase&&window.APP_DATA.firebase.vapidKey));
```

## 4) Surveiller erreurs FCM
Observer console.warn: 'FCM getToken failed:' ou 'FCM token save failed:'
Observer exceptions. Ne pas copier token complet.

## 5) Différencier erreurs
- permission denied/Prompt -> Notification.permission
- ServiceWorkerRegistrationError -> SW
- auth/unauthenticated -> auth.currentUser
- permission-denied (Firestore) -> rules
- invalid-vapid-key/messaging/unsupported-browser -> VAPID/config

## 6) Étapes test
1. Connexion
2. Ouvrir console debug
3. Recharger/forcer init FCM
4. Copier uniquement codes d'erreur (ex: 'permission-denied', 'messaging/unsupported-browser')
5. Vérifier Firestore fcmTokens (présence uniquement)

NE PAS afficher jeton, clés, secrets.
