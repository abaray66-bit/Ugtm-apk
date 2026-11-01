# AUDIT REPORT - UGTM SOUSS-MASSA (Phase A - Read Only)
Date: 2026-11-01T11:50:00Z
Branch: main
Commit départ: 3258ca3 (merge commit)

## État initial
- Repo: abaray66-bit/Ugtm-apk
- Firebase project: ugtm-fns-souss-massa
- Site: https://ugtm-fns-souss-massa.web.app
- App: https://ugtm-fns-souss-massa.web.app/app.html
- Vercel backend (push): https://agile-marimba-ow7rjs2.vercel.app
- Package version: 1.5.81
- Current SW version: ugtm-v48 (www/sw.js)

## Branches / History relevant
- main at 3258ca3
- kilo/glad-qubit-s0f merged into main (recent merges)
- PR #81: "Notifier les responsables des nouveaux signalements" (commit 1d84b16) - added report notifications
- PR #82 / revert: "Revert Notifier les responsables des nouveaux signalements (#81)" (commit 04b64ce) reverted it
- Recent auth fix: ab47ec4 "fix(auth): fallback to redirect on popup blocked and handle redirect result" merged into branch and merged to main context

## Key files examined (read-only)
- www/app.html - UI, notifications modal, routing, PDF generation, filters, swipe
- www/cloud.js - Firebase auth, Firestore, FCM, notifications
- www/firebase-messaging-sw.js - FCM background service worker (handles notificationclick)
- www/sw.js - App shell/service worker for caching
- www/data.js - Config including pushBackendUrl (Vercel) and Firebase config
- api/send-push.js - Vercel serverless function for FCM v1
- api/health.js - Health check
- firestore.rules
- vercel.json
- package.json
- capacitor.config.json
- update.json


## 1) AUTHENTIFICATION GOOGLE (Phase B)
### Current state (www/cloud.js)
- Imports: getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential, reauthenticateWithPopup, reauthenticateWithCredential, onAuthStateChanged, signOut as fbSignOut, deleteUser (no signInWithRedirect/getRedirectResult currently imported/used in current main state)
- signIn(): tries native Capacitor auth if available, else uses signInWithPopup with GoogleAuthProvider; on popup blocked/cancelled it does NOT fallback to redirect in current code (see signIn function around line ~670-720). Also getRedirectResult is not called.
- onAuthStateChanged sets up session, subscriptions, FCM registration etc.
- Redirect result handling was added in recent commits on branch and merged? Looking at history: ab47ec4 added redirect fallback. But current main's www/cloud.js does NOT have signInWithRedirect/getRedirectResult imports or handling. The merge from branch may not have properly preserved it - or it was reverted/overwritten.
- Also in the branch version (kilo/glad-qubit-s0f) there was redirect handling; after merges to main it appears missing.

### Issues identified
- **CRITICAL**: Missing signInWithRedirect/getRedirectResult. Web login fails if popup blocked (common on some browsers/mobile web). The fix from ab47ec4 was intended to handle popup-blocked cases but it's not present in current main.
- Native auth path exists via @capacitor-firebase/authentication.
- Domains authorized in Firebase must allow the web origin; but code issue is fallback missing.

### Correctif minimal envisagé
- Reintroduce imports: signInWithRedirect, getRedirectResult
- In signIn() catch popup errors (auth/popup-blocked, auth/cancelled-popup-request, auth/popup-closed-by-user) -> call signInWithRedirect and return
- Call getRedirectResult(auth) early after getAuth() and handle result (onAuthStateChanged will fire, but good practice to call)
- Keep existing behavior otherwise.


## 2) SERVICE WORKERS & NOTIFICATION NAVIGATION (Phase C)
### www/firebase-messaging-sw.js (current)
- Has notificationclick handler that opens APP_ROOT_URL (https://ugtm-fns-souss-massa.web.app/app.html)
- Uses notificationTargetUrl() to build destination from data (targetType/targetId/news/event) and rejects old Vercel domain
- Listens for FCM background messages via messaging.onBackgroundMessage? Wait - looking at current file:
  - It does importScripts for firebase-app-compat and firebase-messaging-compat
  - It does NOT show explicit messaging.onBackgroundMessage handler in the first part I looked at? Let me look up the full file again.

Looking at the actual file content more:
```js
// Service worker FCM : un clic sur une notification ouvre la racine UGTM.
// Le gestionnaire est déclaré avant Firebase, comme recommandé par FCM.
const APP_ROOT_URL = 'https://ugtm-fns-souss-massa.web.app/app.html';
...
self.addEventListener('notificationclick', ...)
...
// Later might have messaging setup?
```

But I need to see the full file. Let me look.
---
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
      var appClient = clientList.find(function(client){
        return client.url.indexOf(new URL(APP_ROOT_URL).origin + '/') === 0;
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
  // FCM affiche déjà les payloads « notification » en arrière-plan.
  // Les réafficher ici créait une seconde alerte pour le même sujet.
  if(payload&&payload.notification)return;
  var title = 'UGTM';
  var body = (payload.notification && payload.notification.body) || '';
  var notificationData=payload.data||{};
  self.registration.showNotification(title, { body: body, icon: '/icons/ugtm-mark.svg', data: { url: notificationTargetUrl(notificationData), targetType: notificationData.notificationType||'', targetId: notificationData.notificationId||'' } });
});\n\n---\n\n

### www/sw.js (app shell)
- Caches app shell, version ugtm-v48
- Network-first for same-origin GET
- Cache fonts/firebase libs
- No notificationclick handler

### Issues identified
- Two different service workers: firebase-messaging-sw.js (for FCM) and sw.js (app shell). Both registered? Need to check registration.
- firebase-messaging-sw.js is registered by Firebase SDK/getMessaging when using serviceWorkerRegistration? Or separately. Firebase messaging can use default service worker or custom. Also FCM often expects firebase-messaging-sw.js in root scope.
- sw.js is registered by app code for PWA caching.
- They are different files - both needed? firebase-messaging-sw.js handles background FCM messages; sw.js handles caching. They can coexist if registered separately. But need to ensure correct registration.
- Notification navigation: firebase-messaging-sw.js builds target from data and opens app.html on same origin (Firebase). Correct - uses Firebase URL, rejects Vercel.
- Vercel URL (pushBackendUrl) is used by api/send-push.js (backend) and by cloud.js to call it - that's correct as backend, NOT as app navigation destination. The instruction says "L'adresse Vercel ne doit jamais être utilisée comme destination de navigation de l'application officielle" - current code follows this (backend only).
- Check if any old SW caches redirect to Vercel - firebase-messaging-sw.js in current form doesn't redirect to Vercel; it builds URLs to Firebase origin.

### Correctif minimal envisagé
- Ensure firebase-messaging-sw.js properly handles background messages (onBackgroundMessage) to show notifications with correct data for click handling
- Verify registration scopes don't conflict badly
- Keep both SWs if they serve different purposes; ensure no double registration issues
- Make sure notificationclick uses Firebase origin only


## 3) BACKEND FCM & API (Phase D)
### api/send-push.js
- Uses Firebase Admin SDK v1 HTTP API, validates Firebase ID token, checks admin emails/subadmins/province permissions
- Builds notification target to https://ugtm-fns-souss-massa.web.app/app.html with params
- Deduplicates tokens, rate limits, cleans up invalid tokens (classifyFcmError/probe functions exist)
- Health check returns ok with serviceAccount/projectId/adminSdk/oauthToken true (as noted)
- pushBackendUrl in data.js points to Vercel - correct as backend

### Issues identified
- Token renewal: cloud.js registers tokens on login/visibility change; api/send-push.js handles invalid tokens. Seems okay.
- Duplicates: deduplication added in api/send-push.js (Array.from(new Set(tokens))) - good.
- Report notifications: PR #81 added them, PR #82 reverted. Looking at current api/send-push.js and cloud.js - no report notification sending code present now (reverted). The request says "Phase E — NOTIFICATIONS LIÉES AUX SIGNALEMENTS: Examine les changements introduits par la PR #81 et annulés ou modifiés dans la PR #82. L'objectif est de rétablir, si nécessaire, la fonctionnalité de notification des signalements sans réintroduire les défauts précédents." But this is audit phase - we need to report findings, not restore yet without authorization. Will document what was reverted.

### Correctif minimal envisagé
- Ensure token cleanup on invalid tokens
- No changes without authorization


## 4) NOTIFICATIONS LIÉES AUX SIGNALEMENTS (Phase E)
### Git history
- Commit 1d84b16 "Notifier les responsables des nouveaux signalements (#81)" touched api/send-push.js, www/app.html, www/cloud.js, www/firebase-messaging-sw.js, package files
- Commit 04b64ce reverted it (same files)
- Current state has no report notification sending logic (reverted). The revert removed the functionality.

### Issues identified
- Report notifications were added then reverted - users may expect them. Need to understand why reverted (maybe bugs) before restoring. But audit says "examine... and restore if necessary" - but only after authorization in Phase I. Document findings.

### Correctif minimal envisagé
- Only restore after understanding revert reasons and fixing issues properly, with authorization.


## 5) OTA & VERSIONS (Phase F)
- www/update.json: {"versionCode":10581,"versionName":"1.5.81", ...} - matches package.json version 1.5.81
- Android versioning in android/ if present - not fully examined yet
- Workflows in .github/ - not examined deeply
- SW version bumped to ugtm-v48

### Issues identified
- Version consistency seems okay


## 6) PROBLÈMES CONFIRMÉS
1. **CRITICAL - Authentification Google web**: Dans www/cloud.js actuel, pas de signInWithRedirect/getRedirectResult. Si popup bloquée, pas de fallback -> impossible de se connecter sur certains navigateurs. (Fix ab47ec4 exists in history but not present in current main)
2. **MODÉRÉ - Notifications push navigation**: firebase-messaging-sw.js semble correct pour forcer destination Firebase, mais vérifier si ancien SW ou cache cause redirection vers Vercel. Aussi besoin de vérifier enregistrement SW.
3. **INFO - Signalements**: Notifications pour signalements ont été ajoutées puis retirées (PR #81/#82). Fonctionnalité absente actuellement.

## HYPOTHÈSES À VÉRIFIER
- Registration des service workers (firebase-messaging-sw.js vs sw.js) - who registers them and scopes?
- Si l'ancien service worker est en cache et fait des redirections
- Si getRedirectResult doit être appelé même si pas utilisé explicitement
- Pourquoi merge a pu perdre le code de redirect

## FICHIERS CONCERNÉS
- www/cloud.js (auth)
- www/firebase-messaging-sw.js (notification click/navigation)
- www/sw.js (app shell SW)
- www/app.html (notification UI/handling)
- api/send-push.js (backend)
- www/data.js (config)

## COMMITS RESPONSABLES
- ab47ec4: ajout fallback redirect (sur branche, possiblement perdu lors des merges)
- 1d84b16 / 04b64ce: ajout/revert notifications signalements

## RISQUES DE RÉGRESSION
- Ne pas casser auth native Android
- Ne pas casser cache offline
- Ne pas casser notifications existantes
- Ne pas toucher Firestore rules sans justification

## CORRECTIF MINIMAL ENVISAGÉ
1. **Auth**: Ajouter imports signInWithRedirect, getRedirectResult dans cloud.js; dans signIn() catch popup errors et fallback vers redirect; appeler getRedirectResult(auth) après initialisation
2. **SW/Navigation**: Vérifier enregistrement SW, s'assurer firebase-messaging-sw.js est bien utilisé pour FCM, renforcer gestion notificationclick pour forcer origine Firebase
3. **Tests**: Exécuter npm run check, audit:security si possible

## TESTS NÉCESSAIRES
- Connexion Google web avec popup bloqué (simulation) / redirect
- Clic notification arrière-plan -> ouvre app.html Firebase
- Pas de redirection vers Vercel
- Notifications existantes fonctionnent
- Auth Android natif intact

