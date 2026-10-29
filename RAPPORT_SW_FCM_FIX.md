# RAPPORT - Correction SW FCM

## Diff exact
www/firebase-messaging-sw.js: remplacement config dynamique (importScripts /data.js + fallback) par config Firebase publique inline

## Preuve
Valeurs publiques issues de www/data.js:
- apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId

## Tests
- npm run check: OK
- npm run test:audit: OK

## Limites
- Nécessite SW enregistré correctement
- getToken peut échouer si permissions/VAPID/compatibilité
- Déploiement effectif non vérifié
- Pas de test réception en production

## Etat Git
Branche: fix/fcm-notifications-minimal
Modifié: www/firebase-messaging-sw.js
Pas de commit/push/déploiement
