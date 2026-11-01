# AUDIT - commit e28a577 vs 3258ca3 (lecture seule)
Branche: fix/auth-sw-notif-kilo
Commit de départ: 3258ca3
Commit audité: e28a577
Date: 2026-11-01T12:06:00Z

## 1) Diff complet
### www/cloud.js
- Imports: +signInWithRedirect, +getRedirectResult
- signIn(): try/catch autour de signInWithPopup → si popup-blocked/cancelled-popup-request/popup-closed-by-user → signInWithRedirect + return; autres erreurs relancées
- init(): après getAuth(firebaseApp) ajout getRedirectResult(auth).catch(function(){}) avant initialisation Firestore/AppCheck

### www/firebase-messaging-sw.js
- notificationclick: encapsulé dans try/catch, construction URL via racine Firebase, détection hostname vercel.app → remplacement par racine Firebase + search, recherche client sur même origine, navigate() avec .catch fallback focus, openWindow en dernier recours
- Ajout listener push minimal (défensif, ne montre pas de notification)

### www/sw.js
- VERSION: ugtm-v48 → ugtm-v49

## 2) Vérifications
- getRedirectResult(auth): appelé immédiatement après getAuth dans init(), dans try/catch et .catch silencieux → ne bloque pas init, ne perturbe pas Firestore/AppCheck. Correct.
- Fallback redirect: ne masque que les codes popup-blocked/cancelled-popup-request/popup-closed-by-user; autres erreurs sont relancées. Correct.
- Auth Android natif: chemin Capacitor inchangé (non touché). Préservé.
- Données notifications conservées: notificationclick lit event.notification.data et data FCM, passe à notificationTargetUrl et conserve search params pour news/event. openWindow/navigate reçoivent targetUrl construit depuis données. OK.
- URLs Vercel: si targetUrl pointe vers *.vercel.app, remplacé par racine Firebase + search. Si aucun client Firebase, openWindow vers cible "nettoyée" ou fallback APP_ROOT_URL. OK.
- SW: deux SW distincts (sw.js app-shell, firebase-messaging-sw.js FCM) enregistrés séparément; bump version déclenche mise à jour. Pas de suppression de données IndexedDB/Firestore local cache - seul cache HTTP sw.js mis à jour. OK.
- Autres fichiers: seuls www/cloud.js, www/firebase-messaging-sw.js, www/sw.js modifiés. Isolé.

## 3) Tests disponibles / non exécutés
Scripts package.json:
- check: exécuté récemment → OK
- test:audit
- test:firestore (emulators)
- test:notifications (emulators)
- test:firestore:privileges (emulators)
- audit:security

Non exécutés dans cette session (lecture seule/audit): test:audit, test:firestore, test:notifications, test:firestore:privileges, audit:security. Nécessitent potentiellement emulateurs/config.

## Anomalies restantes
- Aucun point bloquant identifié dans le diff. 
- Listener push ajouté est minimal/inutile pour l'instant (peut rester).
- Si un SW très ancien reste actif avec logique personnalisée, mise à jour peut prendre un cycle; bump aide.

## Tests recommandés
- Auth web: popup bloqué → redirect fonctionne, retour via redirect géré par onAuthStateChanged/getRedirectResult
- Notification background click avec data.url Vercel → ouvre Firebase
- Notification background click avec targetType/newsId → conserve params
- Android natif inchangé
