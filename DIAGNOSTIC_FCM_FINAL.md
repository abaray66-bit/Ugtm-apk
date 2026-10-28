# DIAGNOSTIC FINAL FCM - UGTM SOUSS-MASSA

## 1. Contexte
- Dépôt: abaray66-bit/Ugtm-apk
- Branche: main
- Commit: 7f12367 Mise à jour OTA automatique : v1.5.74 (versionCode 10574)
- État Git: clean, aucune modification applicative ni opération de production effectuée pendant cet audit
- Version de référence: v1.5.74

## 2. Diagnostic final consolidé

### Blocages confirmés
| Problème | Preuve technique | Conséquence | Certitude | Correction minimale | Forfait Firebase |
|---|---|---|---|---|---|
| Conflit targetType / rules | firestore.rules:656-683 - hasOnly autorise [title,body,createdAt,read,type,targetScreen,targetId,authorUid,province] sans targetType; www/cloud.js:1508,1636 écrivent targetType:'news'/'event' | create dans notifications/{uid}/items/{id} peut être refusé par permission-denied -> onDocumentCreated non déclenchée -> pas d'envoi push | Élevée | Option A: ajouter targetType au hasOnly dans firestore.rules OU Option B: supprimer targetType à l'écriture dans www/cloud.js | Gratuit |
| SW FCM config fragile | www/firebase-messaging-sw.js:3-25 importe /data.js via importScripts, fallback placeholders; www/data.js contient config+vapidKey mais importScripts asynchrone | Si APP_DATA non chargé au moment init, firebase.messaging() avec placeholders -> getToken/fcm background peut échouer | Élevée | Config inline dans SW avec mêmes valeurs ou attendre chargement APP_DATA | Gratuit |
| Erreurs silencieuses | www/cloud.js:457-470,505-520 catch() vides | Échec sans diagnostic | Élevée | Logger erreurs sans tokens/secrets | Gratuit |
| Déploiement Functions inconnu | functions/index.js:6-30 lit fcmTokens/{uid}, envoie notification | Sans déploiement, pas d'envoi | Élevée | Vérifier Firebase Console > Functions | Gratuit (selon quota) |

## 3. Correction minimale - targetType
**Problème exact:** rules exigent hasOnly sur un set précis sans targetType, code écrit targetType.
**Solution recommandée:** Ajouter `targetType` au tableau hasOnly dans firestore.rules, OU retirer `targetType` dans www/cloud.js (1508, 1636). Préfèrer ajout dans rules si nécessaire pour navigation, mais plus sûr de supprimer côté client pour rester strict.
**Impact:** Uniquement rules ou écriture notifications.

## 4. Service Worker FCM
**Constat:** firebase-messaging-sw.js fait importScripts('/data.js') puis lit APP_DATA. Si data.js non chargé ou APP_DATA absent, utilise placeholders -> risque échec init getToken/background.
**Vérification:** À tester - si APP_DATA disponible dans SW context après importScripts, OK. Sinon config inline nécessaire.

## 5. sendNotificationOnCreate - vérification
**État:** NON VÉRIFIÉ EN PRODUCTION. Nécessite accès Firebase Console > Functions (état déploiement, logs) ou CLI authentifié. Impossible depuis cet environnement.

## 6. Plan unique de résolution (ordre)
1. **Corriger conflit targetType** (priorité 1) - aligner rules et écriture
2. **Rendre SW FCM robuste** (priorité 2) - config inline si nécessaire
3. **Améliorer logs** (priorité 3) - sans exposer tokens
4. **Vérifier déploiement Functions** (priorité 4) - logs si accessible

Tous compatibles avec forfait gratuit selon code actuel.

## 7. Tests nécessaires
- Foreground: connexion + autorisation -> vérifier fcmTokens/{uid} existe
- Création notification: vérifier rules acceptent (pas permission-denied)
- Background: app fermée/arrière-plan -> réception
- Functions: vérifier logs si déployées

**Blocages confirmés:** conflit targetType/rules, SW config timing, erreurs silencieuses, déploiement Functions non vérifié.

**Corrections minimales recommandées:** aligner targetType avec rules; renforcer SW; améliorer logs; vérifier Functions.

**Vérifications de production encore nécessaires:** existence fcmTokens/{uid}, notifications/{uid}/items, état déploiement sendNotificationOnCreate, logs.

**État branche/commit/Git:** main / 7f12367 / clean (aucune modification applicative ni opération de production)
**Confirmation:** Aucune modification applicative, aucun commit/pull request, aucune modification règles/données/config Firebase, aucun déploiement, aucun changement forfait, aucun test modifiant données production, aucun jeton/secret exposé.
