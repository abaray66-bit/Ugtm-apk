# DIAGNOSTIC - Absence collection fcmTokens

## Preuves code (lignes)
- www/cloud.js:443-470 - Initialisation FCM uniquement si Notification existe, demande permission, getToken, setDoc vers fcmTokens/{uid}
- www/cloud.js:458 - getToken avec vapidKey depuis APP_DATA
- www/cloud.js:460-465 - setDoc si token et auth.currentUser, catch avec log code
- firestore.rules:684-695 - create/update requis: signedIn + uid propriétaire + token string non vide + updatedAt == request.time

## Causes possibles
| Cause | Confirmée/Hypothèse | Preuve |
|---|---|---|
| Permission refusée | Hypothèse | Notification.requestPermission() requis, si refusé getToken non appelé |
| Utilisateur non authentifié | Hypothèse | auth.currentUser vérifié avant setDoc/getToken |
| Environnement incompatible | Hypothèse | Requiert window.isSecureContext/Notification, SW enregistré, navigateur compatible |
| VAPID key manquant/incorrect | Hypothèse | getToken appelé avec vapidKey depuis APP_DATA |
| Erreur getToken | Hypothèse | catch log code mais peut échouer silencieusement |
| Erreur écriture Firestore | Hypothèse | Rules exigent updatedAt == request.time et token valide; si échec catch log |
| SW FCM non initialisé | Hypothèse | firebase-messaging-sw.js doit être chargé/configuré |

## Procédure pour enregistrer un jeton (sans exposer valeur)
1. Ouvrir app en HTTPS/localhost
2. Se connecter avec compte autorisé
3. Autoriser notifications
4. Ouvrir DevTools Console - vérifier pas d'erreur FCM
5. DevTools Application > Service Workers - vérifier firebase-messaging-sw.js
6. Firestore Console - vérifier fcmTokens/{uid} (présence uniquement, ne pas copier token)

## Erreurs visibles
Logs via console.warn avec codes erreur si présents. Pas de logs serveur accessibles ici.

Aucune modification effectuée.
