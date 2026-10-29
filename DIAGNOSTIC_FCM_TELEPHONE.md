# DIAGNOSTIC FCM SUR TÉLÉPHONE (APK/WEBVIEW)

## Chemin exact (www/cloud.js)
1. onAuthStateChanged -> setSession(user) (lignes ~430-450)
2. Demande permission si Notification disponible (443-445)
3. Si Notification: getMessaging(app) (454), requestPermission() (447-468)
4. Si permission granted + auth.currentUser: getToken(messaging, {vapidKey}) (457-458)
5. Si token + auth.currentUser: setDoc(doc(db,'fcmTokens',uid), {token, updatedAt}, {merge:true}) (460-465)
6. onMessage pour foreground (467-473)

## Compatibilité APK Android (Capacitor)
- Code utilise Firebase JS SDK + Notification API + Service Worker
- Sur WebView Android: Notification API peut ne pas fonctionner comme navigateur
- getToken nécessite service worker enregistré + vapidKey + environnement compatible
- Pas de code spécifique Capacitor Push ici

## Causes possibles
- Notification non disponible dans WebView
- Permission refusée / non demandée correctement
- SW firebase-messaging-sw.js non enregistré ou scope incorrect
- VAPID key manquant/incorrect
- auth.currentUser absent au moment exécution
- Erreur getToken/setDoc (catch silencieux/log code)
- APK utilise WebView sans support complet

## Obtenir erreurs sans exposer token
- Sur appareil: ouvrir Chrome remote debugging (chrome://inspect) ou logs Android
- Console: regarder console.warn 'FCM getToken failed:' / 'FCM token save failed:'
- Vérifier navigator.serviceWorker.getRegistrations()
- Vérifier Notification.permission

## Méthode courte
1. Connexion
2. Console: logger permission, hasMessaging, hasSW
3. Observer erreurs getToken/setDoc
4. Vérifier fcmTokens après

Aucune modification effectuée.
