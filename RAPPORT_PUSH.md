# Rapport — Réactivation des notifications push après mise à jour APK

## Constat
Après mise à jour de l'APK, le bouton « Activer les notifications push » doit être réactivé manuellement.

## Cause probable
- Le jeton FCM natif est enregistré dans Firestore (`fcmTokens/{uid}`) avec `arrayUnion(nativeToken)`.
- Lors d'une mise à jour APK, l'instance applicative / le jeton natif peut changer (nouvelle installation, réinitialisation du plugin Capacitor Push).
- `pushDeviceState()` indique `tokenSaved=false` si le jeton actuel n'est pas présent dans la liste enregistrée pour cet utilisateur.
- L'UI affiche alors « Autorisation accordée mais appareil non enregistré : appuyez sur Activer… ».
- La permission Android (`granted`) peut persister, mais l'enregistrement côté serveur (token) doit être refait.

## Conséquence
- L'utilisateur doit cliquer « Activer » pour réenregistrer le jeton actuel.
- Sans cela, les notifications ne sont pas envoyées à cet appareil.

## Recommandation (sans modification ici)
- Enregistrer automatiquement le token au démarrage si permission accordée (appel `enablePushNotifications` silencieux).
- Ou comparer le token natif actuel avec la liste stockée et réenregistrer si absent.

## Fichiers concernés
- www/app.html : `enablePushFromClick`, `refreshPushStatus`
- www/cloud.js : `enablePushNotifications`, `pushDeviceState`
">
filePath">
/workspace/app/RAPPORT_PUSH.md