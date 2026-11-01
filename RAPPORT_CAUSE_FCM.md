# RAPPORT CAUSE ÉCHEC FCM

## Changements récents
- c78d878: vapidKey lu depuis APP_DATA, SW lit data.js
- 16eecf3: ajout targetType règles, SW renforcé, logs améliorés
- 0591ac0: vapidKey ajouté dans data.js

## Chemin actuel (www/cloud.js:454-468)
- getMessaging(app) appelé après auth
- Notification.requestPermission() requis
- getToken avec vapidKey depuis APP_DATA
- setDoc vers fcmTokens/{uid} si token + auth.currentUser

## Cause la plus probable
Si notifications autorisées avant régression mais collection absente maintenant:
1. **SW FCM non chargé/configuré** - firebase-messaging-sw.js doit être enregistré. Sur APK WebView, enregistrement SW peut échouer.
2. **getToken() échoue silencieusement** - si SW absent/incorrect, getToken rejette. Logs ajoutés mais besoin console.
3. **Permission/Notification API** - WebView peut restreindre Notification
4. **VAPID key** - si absent/incorrect, getToken échoue
5. **Timing** - auth.currentUser doit exister

## Preuve
- Code requiert service worker pour getToken web
- SW essaie charger data.js; si échec peut initialiser avec placeholders
- Erreurs maintenant loguées avec code

## Correction minimale recommandée
1. Vérifier SW enregistré (chrome://inspect / console)
2. S'assurer firebase-messaging-sw.js accessible à racine
3. Vérifier APP_DATA.firebase.vapidKey présent
4. Si getToken échoue avec messaging/unsupported-browser -> SW manquant
5. Si permission-denied Firestore -> rules OK maintenant avec targetType

Aucune modification effectuée.
