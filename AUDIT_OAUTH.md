# AUDIT OAuth Google / Firebase Auth - fix/auth-sync-kilo @ 85aaa7c
Date: 2026-11-01T15:07:00Z

## 1) Configuration utilisée par le code
- www/data.js: firebase.apiKey, authDomain "ugtm-fns-souss-massa.web.app", projectId "ugtm-fns-souss-massa", appId
- www/cloud.js: imports GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult; utilise GoogleAuthProvider() par défaut (pas de clientId custom)
- www/firebase-messaging-sw.js: même config Firebase
- authDomain = ugtm-fns-souss-massa.web.app (Firebase Hosting)

## 2) Flux OAuth
- signInWithPopup() avec GoogleAuthProvider par défaut - utilise le client OAuth Web géré par Firebase
- Fallback signInWithRedirect() si popup bloquée/annulée/fermée
- getRedirectResult() appelé après init (logs ajoutés)
- Android natif via @capacitor-firebase/authentication si Capacitor natif

## 3) Incohérences possibles
- Google Cloud OAuth Web peut nécessiter "https://ugtm-fns-souss-massa.web.app" dans origines JavaScript si utilisation directe du client OAuth. Firebase Auth gère généralement ça via authDomain.
- Si les domaines autorisés Firebase Auth manquent le domaine web.app, ça peut causer auth/unauthorized-domain.
- Configuration Android (package ma.ugtm.souss.massa) non présente dans ce repo - SHA-1/SHA-256 à vérifier dans console Firebase/Google Cloud.

## 4) Preuves
- Fichiers modifiés: www/cloud.js, www/app.html (auth sync)
- Projet: ugtm-fns-souss-massa (17 occurrences)
- Domaine app: 11 occurrences
- Vercel backend: conservé (api/send-push.js, pushBackendUrl dans data.js)

## Conclusion
- Configuration code cohérente avec projet Firebase
- Absence de clientId custom - normal avec Firebase Auth
- Hypothèse: domaine non autorisé dans Firebase Auth ou configuration OAuth Web à vérifier côté console
- Aucune modification effectuée
