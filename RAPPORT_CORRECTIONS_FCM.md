# RAPPORT CORRECTIONS FCM

## Fichiers modifiés
- firestore.rules (ligne ~674): ajout targetType dans hasOnly notifications/{uid}/items/{id}
- www/firebase-messaging-sw.js: config plus robuste (importScripts + fallback XMLHttpRequest)
- www/cloud.js: amélioration logs FCM sans tokens
- DIAGNOSTIC_FCM_FINAL.md: mis à jour

## Preuves
- rules: hasOnly inclut maintenant targetType
- SW: essaie charger data.js, fallback si absent
- cloud.js: catch avec console.warn(code)

## Tests
- npm run check: OK
- npm run test:audit: OK

## État Function sendNotificationOnCreate
NON VÉRIFIÉ EN PRODUCTION (accès impossible)

## État Git
Branche: fix/fcm-notifications-minimal
Commit départ: 7f12367
Nouveau commit: 16eecf3
Status: clean

## Confirmation
Aucune modification production, aucun déploiement, aucun push distant sans autorisation. Aucune clé/token exposé.
