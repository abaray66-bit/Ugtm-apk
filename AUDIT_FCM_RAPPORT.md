# RAPPORT AUDIT NOTIFICATIONS FCM UGTM SOUSS-MASSA

## 1. Branche, commit SHA, état Git
- Branche: main
- Commit SHA: 7f12367 Mise à jour OTA automatique : v1.5.74 (versionCode 10574)
- État: clean (nothing to commit)

## 2. Fichiers examinés
www/cloud.js, www/firebase-messaging-sw.js, www/data.js, www/sw.js, firestore.rules, functions/index.js, functions/package.json, firebase.json, .github/workflows/*

## 3. A) Enregistrement FCM
- getMessaging() initialisé dans cloud.js ~450 (conditionnel: typeof Notification != undefined)
- getToken() appelé ~457-465 avec vapidKey lu depuis APP_DATA.firebase.vapidKey
- Enregistrement dans fcmTokens/{uid} via setDoc avec merge:true, updatedAt: serverTimestamp()
- Authentification: vérifie auth.currentUser avant enregistrement
- Erreurs: plupart catch silencieux
- Écrit uniquement si permission === 'granted' et token obtenu
- Compatible web/PWA; sur Android Capacitor utilise même WebView, dépend SW

## 3. B) Service worker
- firebase-messaging-sw.js: importe firebase-app-compat + firebase-messaging-compat, essaie importScripts('/data.js'), lit firebaseConfig depuis self.APP_DATA.firebase sinon placeholders
- Problème: importScripts('/data.js') dans SW ne garantit pas que APP_DATA est défini au moment de l'exécution; si APP_DATA absent, utilise placeholders
- sw.js (PWA): pas de FCM, gestion cache
- Chemin: firebase-messaging-sw.js à la racine /www -> servi comme /firebase-messaging-sw.js
- Scope: par défaut scope racine si enregistré depuis racine
- Risque REPLACE_WITH_* si APP_DATA non chargé

## 3. C) Cohérence Firestore
- notifications/{uid}/items/{id}: create autorise champs [title,body,createdAt,read,type,targetScreen,targetId,authorUid,province] - targetType NON dans la liste autorisée. Code cloud.js écrit targetType (1508, 1636). Rules exigent createdAt == request.time.
- fcmTokens/{uid}: create/update exige token string non vide, updatedAt == request.time - cohérent avec code
- Incohérence possible: si code écrit targetType, création bloquée par rules

## 3. D) Envoi push
- functions/index.js: onDocumentCreated notifications/{uid}/items/{id}, lit fcmTokens/{uid}, si token existe envoie via getMessaging().send() avec notification.title/body uniquement
- Dépendances: firebase-admin/app, firebase-admin/firestore, firebase-admin/messaging, firebase-functions/v2/firestore
- Nécessite déploiement Cloud Functions + permissions
- Pas de clé privée côté client (OK)

## 4. Tableau problème/preuve/conséquence/certitude
| Problème | Preuve | Conséquence | Certitude |
|---|---|---|---|
| targetType non autorisé par rules | rules:656-683 n'inclut pas targetType; cloud.js:1508,1636 écrit targetType | Création notification peut être refusée (permission-denied) -> function pas déclenchée | Élevée |
| SW lit data.js mais timing | firebase-messaging-sw.js importe /data.js, si non chargé utilise placeholders | getToken/fcm background peut échouer | Élevée |
| VAPID key présente mais SW config fragile | data.js vapidKey renseigné; SW dépend importScripts | Si SW init avec placeholders, push background impossible | Élevée |
| Erreurs silencieuses | cloud.js catch vides | Difficile à diagnostiquer | Élevée |
| Functions déploiement non vérifiable | impossible depuis env | Envoi push peut ne pas fonctionner | Élevée |

## 5. Causes confirmées / hypothèses
Confirmées: rules autorisent uniquement certains champs (targetType absent), SW dépend importScripts data.js, function envoie uniquement notification, vapidKey lu depuis APP_DATA
Hypothèses: fcmTokens manquant, functions non déployées, permissions refusées, token invalide

## 6. Corrections proposées (sans appliquer)
- Ajouter targetType aux champs autorisés dans firestore.rules OU supprimer targetType à l'écriture
- Rendre firebase-messaging-sw.js plus robuste (config inline)
- Logger erreurs FCM (sans exposer tokens)
- Gérer token invalide dans function (supprimer fcmTokens si erreur)
- Vérifier enregistrement SW

## 7. Solution sans changement forfait
Possible si functions déployées sur plan actuel, si règles correctes, si token enregistré. Limites: nécessite HTTPS, permissions, SW correct.

## 8. Tests nécessaires
1. Connexion + autorisation notifications -> vérifier fcmTokens
2. Créer notification -> vérifier rules acceptent
3. Vérifier function logs
4. Tester foreground/background

## 9. Contrôles production
Réalisés: aucun (lecture seule code)
Impossibles: existence fcmTokens/notifications, état functions, logs

**CONFIRMATION:** Aucun fichier modifié, aucun document Firestore créé/modifié/supprimé, aucune notification envoyée, aucun déploiement effectué, aucun paramètre Firebase modifié.
