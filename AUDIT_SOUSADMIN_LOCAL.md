# AUDIT TECHNIQUE CIBLÉ — SOUS-ADMINISTRATEUR LOCAL (subadminLocal)

**Mode : lecture seule stricte.** Aucun fichier modifié, aucune écriture Firestore, aucune migration, aucun commit, aucun push, aucun déploiement.

**Date :** 2026-11-11
**Workspace :** /workspace/app
**Fichiers examinés :** `firestore.rules` (784 lignes), `www/cloud.js` (2713 lignes), `www/data.js`, `www/app.html` (11495 lignes)

---

## 0. CONTEXTE ET EXISTANT

Le projet gère deux niveaux administratifs uniquement :

- **isAdmin** (firestore.rules:28-32) : emails dans `bootstrapAdminEmails()` (`abaray66@gmail.com`, data.js:20) ou document `config/admins`.
- **isSubAdmin** (firestore.rules:34-39) : document `members/{uid}` avec `status == 'active'` et `role == 'subadmin'` ; province via `adminProvince`.

Les champs `subadminLocal`, `localStructures`, `localContacts`, `localAdminProposals` et `structureId` n'existent pas encore. `etab` est du texte libre (max 160), pas un identifiant stable.

---

## 1. POINT 1 — CIRCUIT COMPLET DE VALIDATION DES ADHÉSIONS

### 1.1 Fonctions examinées et ordre d'exécution réel

| Étape | Fonction | Fichier:Ligne | Action |
|-------|----------|---------------|--------|
| A | `updateAdhesionStatus()` | cloud.js:2085-2094 | Met à jour `admissionRequests/{uid}` : `status`, `adminNote`, `updatedAt`. Statuts acceptés : `pending`, `needs_completion`, `accepted`, `refused`. |
| B | `signAdhesion()` | cloud.js:1171-1216 | Met `status:'accepted'`, `adminSignature`, `signedBy`, `signedAt`, `adminNote`, `updatedAt` sur `adhesionRequests/{uid}`, puis appelle `activateMemberFromRequest(uid)`. |
| C | `activateMemberFromRequest()` | cloud.js:1223-1295 | Vérifie `req.status === 'accepted'`, construit la fiche membre depuis `req.application`, attribue `memberNo` via `counters/memberNumbers` (transaction), écrit `members/{uid}`, puis met à jour `signedAt`/`updatedAt` sur la demande. |
| D | `setStatus()` | cloud.js:1656-1746 | Active ou bloque un membre directement sur `members/{uid}`. Si `status === 'active'` et pas de `memberNo`, attribue un numéro via le compteur (transaction sur `counters/memberNumbers` + update sur `members/{uid}`). |

### 1.2 Appels depuis l'UI (app.html)

- `signAdhesion` (app.html:9569-9571) : réservé à `S.isAdmin || S.isSubAdmin`, ouvre le dossier puis signe.
- `reviewAdhesion` / `updateAdhesionStatus` (app.html:9597-9603) : `S.isAdmin || S.isSubAdmin`, modifie seulement le statut (+ note).
- `delAdhesion` (app.html:9585-9595) : `S.isAdmin` uniquement, bloque si `pending` ou `needs_completion`.
- `activate` / `setStatus(uid,'active')` (app.html:9493-9502) : `S.isAdmin || S.isSubAdmin`, active un membre directement.
- `block` / `setStatus(uid,'blocked')` (app.html:9506-9514) : `S.isAdmin` uniquement.

### 1.3 Constat : signature et activation ne sont PAS atomiques

`signAdhesion()` (cloud.js:1177-1184) écrit sur `adhesionRequests/{uid}`, **puis** (cloud.js:1185) appelle `activateMemberFromRequest()` en attente séparée. Il n'y a **aucune transaction Firestore** englobant les deux écritures.

**Conséquence :** si `signAdhesion` réussit (adhésion passée en `accepted`) mais que `activateMemberFromRequest` échoue (erreur réseau, règle Firestore refusée, exception), l'adhésion reste `accepted` sans qu'aucun membre ne soit créé. État incohérent possible.

### 1.4 Une demande peut être acceptée sans activation du membre

**OUI.** `updateAdhesionStatus()` (cloud.js:2085-2094) positionne `status: 'accepted'` sur `adhesionRequests/{uid}` mais n'appelle jamais `activateMemberFromRequest`. La demande est "acceptée" au sens Firestore, mais aucun membre n'est activé et aucun numéro `SM-XXXX` n'est attribué.

La règle Firestore `adhesionRequests` update (firestore.rules:638-658) autorise la transition vers `accepted` avec signature électronique, sans exister d'activation membre associée.

### 1.5 Un membre peut être activé sans validation correcte de sa demande

**OUI.** `setStatus(uid, 'active')` (cloud.js:1656-1721) active directement un document `members/{uid}` sans vérifier qu'une `adhesionRequests/{uid}` existe, qu'elle est en statut `accepted`, ni qu'elle a été signée. Un membre peut être mis en `active` avec un `memberNo` alors qu'aucune demande d'adhésion n'a jamais été déposée ni validée.

La règle Firestore `members/{uid}` update (firestore.rules:129-152) impose que `memberNo` corresponde à `getAfter(counter).lastMemberNo`, mais ne vérifie **aucune** liaison avec une demande d'adhésion acceptée.

### 1.6 Une erreur intermédiaire peut laisser des données incohérentes

**OUI.** Plusieurs points de rupture :

1. `signAdhesion` écrit `accepted` + signature, puis `activateMemberFromRequest` échoue → adhésion acceptée sans membre (orphan).
2. `activateMemberFromRequest` crée le membre et met à jour le compteur, mais l'update final de `signedAt`/`updatedAt` sur la demande (cloud.js:1293) échoue → membre activé sans horodatage de complétion sur la demande.
3. `setStatus` active un membre sans lien avec une demande → membre actif sans dossier d'adhésion.

### 1.7 Double validation simultanée

**OUI, possible.** `signAdhesion()` positionne `status:'accepted'` **sans tester le statut courant** (pas de condition `if (req.status !== 'accepted')`). Deux appels concurrents de `signAdhesion` sur la même demande peuvent tous deux réussir :

- Firestore update rule (firestore.rules:642) autorise `status in ['pending', 'needs_completion', 'accepted', 'refused']` — passer de `accepted` à `accepted` est permis.
- `signedBy` / `signedAt` seraient écrasés par le second appelant.

Aucune règle n'impose que le statut courant soit `pending` ou `needs_completion` avant une acceptation.

### 1.8 Attribution de memberNo et structureId

- `memberNo` : attribué dans `activateMemberFromRequest` (cloud.js:1267-1291) via transaction sur `counters/memberNumbers`, ou dans `setStatus` (cloud.js:1695-1721) de même manière. Format `SM-XXXX` (padStart 4).
- `structureId` : **n'existe pas nulle part**. Pas de champ, pas de collecte, pas de règle. Ce champ est à créer ex nihilo pour le niveau `subadminLocal`.

### 1.9 Droits Firestore nécessaires à chaque opération

| Opération | Lectures nécessaires | Écritures nécessaires | Règles concernées |
|-----------|---------------------|----------------------|-------------------|
| `updateAdhesionStatus` | `adhesionRequests/{uid}` | `adhesionRequests/{uid}` (update) | firestore.rules:638-699 |
| `signAdhesion` | `adhesionRequests/{uid}` | `adhesionRequests/{uid}` (update) | firestore.rules:638-658 |
| `activateMemberFromRequest` | `adhesionRequests/{uid}`, `members/{uid}`, `counters/memberNumbers` | `members/{uid}` (set/update), `counters/memberNumbers` (set), `adhesionRequests/{uid}` (update) | firestore.rules:87-171, 190-233 |
| `setStatus` (active) | `members/{uid}`, `counters/memberNumbers` | `members/{uid}` (update), `counters/memberNumbers` (set) | firestore.rules:87-171, 190-233 |

---

## 2. POINT 2 — COMPTEUR GLOBAL SM-XXXX

### 2.1 Schéma du compteur

Document `counters/memberNumbers`, champs : `next` (int), `lastMemberNo` (string `SM-[0-9]{4,}`), `memberUid` (string), `updatedAt` (timestamp).

Règles :
- **Read** (firestore.rules:191) : `isAdmin() || isSubAdmin()`.
- **Create** (firestore.rules:193-212) : `isAdmin()` OU (`isSubAdmin()` && `counterId == 'memberNumbers'` && clés exactement `['next','lastMemberNo','memberUid','updatedAt']` && `next is int` && `next >= 2` && `lastMemberNo matches SM-[0-9]{4,}` && `memberUid is string` && `updatedAt == request.time` && (membre absent ou `status == 'pending'`) && `getAfter(member).status == 'active'` && `getAfter(member).memberNo == lastMemberNo` && `getAfter(member).prov == assignedProvince()`).
- **Update** (firestore.rules:214-232) : `isAdmin()` OU (`isSubAdmin()` && même schéma && `next == resource.data.next + 1` && mêmes vérifications getAfter sur le membre).

### 2.2 Scénario de création du compteur quand absent

Dans `activateMemberFromRequest` (cloud.js:1269-1278) et `setStatus` (cloud.js:1679-1693) : si le document n'existe pas, le code lit **tous** les membres (`getDocs(collection(db,'members'))`) pour trouver le `maxNo` existant, puis `seed = maxNo + 1` (ou 1 si aucun).

**Problème pour un sous-admin (y compris local) :** la règle `members/{uid}` read (firestore.rules:88-90) ne permet pas la lecture d'une collection entière à un sous-admin. Seul `isAdmin()` ou soi-même ou `isSubAdmin() && prov match` sont autorisés. `getDocs(collection(db,'members'))` sera **refusé** pour un sous-admin → le catch (cloud.js:1690-1692) tombe sur `seed = 1`.

Si le compteur est absent et qu'il existe déjà des membres (numérotés manuellement ou par un admin précédent), un sous-admin qui crée le compteur repartira de `SM-0001` → **risque de collision de numéro**.

### 2.3 next représente-t-il le prochain numéro à attribuer ?

**OUI.** Dans la transaction (cloud.js:1282 / cloud.js:1698-1700) : `next = seqSnap.data().next || 1`, puis `no = 'SM-' + next.padStart(4,'0')`, puis `tx.set(seqRef, {next: next + 1, ...})`. Donc `next` est le prochain numéro à émettre, et il est incrémenté après usage.

### 2.4 next = 1 ou next = 2 accepté à la création ?

La règle create (firestore.rules:201) impose `next >= 2`. Donc :

- `next = 1` à la création : **REFUSÉ** par la règle.
- `next = 2` à la création : **ACCEPTÉ** par la règle.

Cependant, le code JavaScript met `next: Math.floor(next) + 1` (cloud.js:1285 / cloud.js:1708). Si `seed = 1` (compteur absent, aucun membre), `next = 1` dans la transaction, puis `tx.set` écrit `next: 2`. La règle create vérifie `request.resource.data.next >= 2` → `2 >= 2` → **OK**. Cela fonctionne par hasard, mais c'est fragile : si le code écrivait jamais `next: 1` directement, la création serait refusée.

### 2.5 Les règles create/update autorisent-elles les écritures des transactions actuelles ?

**Partiellement, avec des fragilités :**

1. **Create quand compteur absent** : le code fait `tx.set(seqRef, {...})`. Firestore traite `set` sur document inexistant comme un create. La règle create s'applique. Elle exige `getAfter(member).memberNo == lastMemberNo` et `getAfter(member).prov == assignedProvince()`. Dans `activateMemberFromRequest`, `tx.set(ref, {...data, memberNo: no})` avec `no === lastMemberNo`. La province du membre vient de `app.province`. Pour un sous-admin, `assignedProvince()` doit correspondre. → OK si province cohérente.

2. **Update quand compteur existe** : le code fait aussi `tx.set(seqRef, {...})` (pas `tx.update`). Firestore traite `set` sur document existant comme un update (fusion ou remplacement selon options). La règle update s'applique, exigeant `next == resource.data.next + 1`. → OK si le code passe bien `next+1`.

3. **Problème : sous-admin et lecture globale des membres.** Quand le compteur est absent, le code fait `getDocs(collection(db,'members'))` (cloud.js:1272 / cloud.js:1684). Cette lecture est **refusée** pour un sous-admin (pas de règle de collection read pour members). Le code tombe dans le catch et met `seed = 1`. Si le compteur est réellement absent mais que des membres existent déjà, le sous-admin créera le compteur avec `next: 2` et `lastMemberNo: SM-0001`, potentiellement en collision avec un `memberNo` existant.

### 2.6 getAfter vérifie-t-il suffisamment les relations compteur ↔ membre ?

**Partiellement.** `getAfter` vérifie :
- `member.status == 'active'`
- `member.memberNo == lastMemberNo`
- `member.prov == assignedProvince()` (pour sous-admin)

Mais `getAfter` ne vérifie **pas** que `lastMemberNo` n'a pas déjà été utilisé par un autre membre. Il ne vérifie pas non plus l'unicité globale de `memberNo` à travers toute la collection `members`. L'unicité repose uniquement sur l'incrémentation de `next` dans le compteur, ce qui suppose que le compteur est toujours cohérent avec l'état réel des membres.

**Important :** getAfter ne garantit **pas seul** l'unicité globale. Si le compteur est corrompu ou réinitialisé manuellement, des doublons peuvent apparaître.

### 2.7 Deux activations concurrentes peuvent-elles produire un doublon ?

**Via `runTransaction` : non.** Firestore transactions sont sérialisables ; si deux transactions modifient `counters/memberNumbers` en parallèle, l'une est rejetée et réessayée avec la nouvelle valeur de `next`. Pas de doublon via ce chemin.

**Via `setStatus` sans transaction sur le membre existant :** `setStatus` fait un `getDoc` avant la transaction (cloud.js:1680). Si le membre existe déjà avec un `memberNo`, la branche `if (member && member.status === 'active')` (cloud.js:1257 dans activateMemberFromRequest, ou le path `setStatus` sans counter) ne passe pas par le compteur. Mais si deux appels `setStatus(uid, 'active')` concurrents arrivent sur un membre sans `memberNo`, chacun lance une transaction sur le compteur — les transactions se sérialisent, pas de doublon sur le compteur. Cependant, si l'un des deux appelle `activateMemberFromRequest` et l'autre `setStatus` sur le même membre, les deux pourraient écrire sur `members/{uid}` en dehors d'une transaction commune → risque d'écrasement, pas nécessairement de doublon de numéro mais d'incohérence.

### 2.8 Un numéro déjà attribué peut-il être réutilisé ?

**Par le flux normal : non.** `next` ne fait qu'incrémenter. `lastMemberNo` trace le dernier émis.

**Par intervention manuelle : oui.** Un administrateur peut écraser `counters/memberNumbers` avec un `next` plus bas (règle create/update autorise `isAdmin` librement). Ensuite, de nouveaux membres recevraient des numéros déjà attribués.

### 2.9 Une transaction d'un sous-administrateur local peut-elle fonctionner sans accès global à members ?

**Non, pas de façon fiable.** Quand le compteur est absent, le code a besoin de lire tous les membres pour calculer `seed` (cloud.js:1272 / 1684). Un sous-admin local n'a pas ce droit (règle members read). Il tomberait sur `seed = 1`, risquant la collision si des membres existent déjà.

Quand le compteur existe, le sous-admin peut lire le compteur (règle read line 191 : `isAdmin() || isSubAdmin()`) et la transaction met à jour le membre de sa propre province (règle update members exige `prov == assignedProvince()`). Mais il ne peut activer que des membres de **sa** province, pas n'importe quel membre.

### 2.10 Synthèse des risques du compteur

| Risque | Niveau | Description |
|--------|--------|-------------|
| Collision si compteur absent + sous-admin | Élevé | `getDocs(members)` refusé → `seed = 1` → possible réattribution de `SM-0001` |
| `next = 1` refusé à la création | Moyen | Règle exige `next >= 2`, code écrit `next + 1` (fragile) |
| Pas d'unicité globale garantie par getAfter | Moyen | getAfter vérifie le membre visé, pas l'absence de doublon ailleurs |
| Réinitialisation manuelle par admin | Faible | isAdmin peut écraser le compteur, réutilisant des numéros |
| Sous-admin local sans accès global members | Élevé | Ne peut pas initialiser le compteur de façon fiable s'il est absent |

---

## 3. POINT 3 — SCHÉMA ET RÈGLES DES ADHÉSIONS

### 3.1 Schéma racine actuel

`adhesionTopKeys()` (firestore.rules:558-562) :
```
['uid', 'email', 'province', 'application', 'signature',
 'status', 'adminNote', 'adminSignature', 'signedBy',
 'signedAt', 'createdAt', 'updatedAt']
```

Règle create (firestore.rules:610-631) : `hasAll` + `hasOnly` sur ces 12 clés.
Règle update (firestore.rules:640-641) : `affectedKeys().hasOnly(['status', 'adminNote', 'adminSignature', 'signedBy', 'signedAt', 'updatedAt'])`.

### 3.2 Schéma application actuel

`adhesionAppKeys()` (firestore.rules:520-524) :
```
['nom', 'prenom', 'cin', 'dob', 'phone', 'address',
 'province', 'establishment', 'service', 'function',
 'specialty', 'ppr', 'type', 'reason', 'commitment', 'date']
```

Règle `adhesionAppOk()` (firestore.rules:572-600) : `app.keys().hasAll(adhesionAppKeys()) && app.keys().hasOnly(adhesionAppKeys())`.

### 3.3 Ajout futur des champs — ce qui est refusé par hasOnly()

**À la racine de la demande :** `validatedBy`, `validatedAt`, `validatedByRole` seraient **REFUSÉS** par `hasOnly(['status', 'adminNote', 'adminSignature', 'signedBy', 'signedAt', 'updatedAt'])` à la ligne 641. Ils ne figurent pas dans la liste autorisée. Il faut les ajouter explicitement à cette liste (ou créer une règle séparée).

**Dans `application` :** `application.structureId` serait **REFUSÉ** par `adhesionAppOk()` car `app.keys().hasOnly(adhesionAppKeys())` (ligne 575) n'inclut pas `structureId`. Il faut l'ajouter à `adhesionAppKeys()`.

### 3.4 Le demandeur peut-il renseigner les champs de validation lui-même ?

**Non.** Voici pourquoi :

1. **Création (firestore.rules:610-631)** : seules les 12 clés racines sont autorisées, `status` doit être `'pending'`, et aucun champ de validation n'est présent. Le demandeur ne peut pas créer avec `validatedBy` etc.

2. **Mise à jour par l'adhérent (firestore.rules:660-699)** : l'adhérent ne peut modifier que `['application', 'signature', 'status', 'adminNote', 'adminSignature', 'signedBy', 'signedAt', 'updatedAt']` (ligne 688), et doit vider `adminSignature`/`signedBy`/`signedAt` (lignes 690-692). Il ne peut pas ajouter `validatedBy`/`validatedAt`/`validatedByRole`.

3. **Mise à jour par l'admin (firestore.rules:638-658)** : seule `isAdmin()` ou `adhesionIsSubAdminOf()` peut modifier, sur les 6 clés autorisées. Le demandeur (`request.auth.uid == uid`) n'a pas ce droit sur ces champs (le second bloc de l'update, ligne 660, est réservé à l'adhérent mais n'autorise pas les champs de validation non plus).

Donc les champs de traçabilité sont réservés à l'administration et ne peuvent pas être auto-renseignés par le demandeur.

### 3.5 Compatibilité proposée (lecture seule — aucune modification)

| Scénario | Recommandation |
|----------|---------------|
| Anciennes demandes sans `structureId` | `structureId` optionnel à la lecture ; `adhesionAppKeys()` garde `hasOnly` sans `structureId` pour les anciennes, ou ajoute `structureId` comme optionnel avec une règle de migration |
| Nouvelles demandes avec `structureId` obligatoire | Ajouter `structureId` à `adhesionAppKeys()` avec `hasAll` + validation (non vide, format attendu) |
| Modifications admin sur demandes historiques | Autoriser l'admin à ajouter `structureId` sur une demande existante via une clé update dédiée, sans modifier `application` signé |
| `validatedBy` / `validatedAt` / `validatedByRole` | Ajouter à la liste `hasOnly` de l'update racine (ligne 641), réservés à `isAdmin()` ou `isSubAdminOf(province)`, non modifiables par le demandeur |

---

## 4. POINT 4 — CORRECTION DES ERREURS DU CONTRE-AUDIT

### 4.1 Proposition erronée (à ne pas utiliser)

```javascript
role != 'subadmin' || role != 'subadminLocal'
```

Cette condition est **toujours vraie** : un `role` ne peut pas être simultanément `'subadmin'` et `'subadminLocal'`. Si `role == 'subadmin'`, alors `role != 'subadminLocal'` est vrai → l'ensemble est vrai. Si `role == 'subadminLocal'`, alors `role != 'subadmin'` est vrai → l'ensemble est vrai. Si `role` est autre chose, les deux sont vrais. Cette règle n'interdit **rien**.

### 4.2 Condition logique correcte

Pour interdire l'auto-suppression des deux sous-administrateurs, il faut **ET** (AND), pas OU :

```javascript
role != 'subadmin' && role != 'subadminLocal'
```

ou, de manière équivalente :

```javascript
!(role == 'subadmin' || role == 'subadminLocal')
```

### 4.3 Comportement actuel vs futur

| | Actuel (firestore.rules:176-178) | Futur (avec subadminLocal) |
|---|---|---|
| Suppression membres | `isAdmin()` ou (soi-même ET `role != 'subadmin'`) | `isAdmin()` ou (soi-même ET `role != 'subadmin' && role != 'subadminLocal'`) |
| Rôles bloqués | `subadmin` uniquement | `subadmin` et `subadminLocal` |

---

## 5. POINT 5 — RAPPORT : RISQUES, INCOMPATIBILITÉS, SOLUTIONS, TESTS

### 5.1 Risques démontrés (évidence dans le code)

| # | Risque | Preuve | Gravité |
|---|--------|--------|---------|
| R1 | Signature et activation non atomiques | `signAdhesion` (cloud.js:1177-1185) écrit adhesion, puis appelle `activateMemberFromRequest` sans transaction commune | Élevé |
| R2 | Acceptation sans activation possible | `updateAdhesionStatus` (cloud.js:2085-2094) ne déclenche pas d'activation | Élevé |
| R3 | Activation sans demande validée | `setStatus(uid,'active')` (cloud.js:1656-1721) ne vérifie aucune `adhesionRequests` | Élevé |
| R4 | Double validation simultanée | `signAdhesion` ne teste pas le statut courant (cloud.js:1177) | Moyen |
| R5 | Collision de numéro si compteur absent + sous-admin | `getDocs(members)` refusé pour sous-admin (cloud.js:1684, catch line 1690-1692) → `seed = 1` | Élevé |
| R6 | `next = 1` refusé à la création du compteur | Règle create firestore.rules:201 (`next >= 2`) | Moyen |
| R7 | `structureId`, `validatedBy`, `validatedAt`, `validatedByRole` refusés par `hasOnly()` | firestore.rules:575, 641 | Élevé (bloquant pour le développement) |
| R8 | Logique OU au lieu de ET dans contre-audit | `role != 'subadmin' || role != 'subadminLocal'` toujours vrai | Moyen |

### 5.2 Risques hypothétiques (non prouvés, à surveiller)

| # | Risque | Pourquoi hypothétique |
|---|--------|----------------------|
| H1 | Perte de `signedAt` si `activateMemberFromRequest` réussit mais l'update final (cloud.js:1293) échoue | Dépend d'une erreur partielle après transaction réussie |
| H2 | Numéro réutilisé après réinitialisation manuelle du compteur par un admin | Nécessite une intervention manuelle outside the normal flow |
| H3 | Deux appels concurrents `setStatus` + `activateMemberFromRequest` sur le même membre | Nécessite un appel croisé inhabituel |

### 5.3 Incompatibilités avec les règles Firestore (pour le niveau subadminLocal)

| Champ / Fonctionnalité | Règle actuelle | Incompatibilité |
|-----------------------|---------------|-----------------|
| `isSubAdminLocal()` | N'existe pas | Doit être créée (parallèle à `isSubAdmin` line 34) |
| `assignedLocalStructure()` | N'existe pas | Doit être créée (parallèle à `assignedProvince` line 41) |
| `application.structureId` | `adhesionAppKeys()` hasOnly (line 575) | `structureId` absent → refusé |
| `validatedBy` / `validatedAt` / `validatedByRole` | Update hasOnly (line 641) | Absents → refusés |
| Écriture `counters/memberNumbers` par subadminLocal | `isSubAdmin()` (line 191, 194, 215) | `isSubAdminLocal()` n'est pas inclus → refusé |
| Écriture `members/{uid}` par subadminLocal | `resource.data.prov == assignedProvince()` (line 134) | subadminLocal aurait besoin d'une structure, pas d'une province |
| Suppression de compte subadminLocal | `role != 'subadmin'` (line 178) | Ne couvre pas `subadminLocal` → auto-suppression possible |

### 5.4 Solution technique recommandée pour chaque problème

| Problème | Solution recommandée (conceptuelle, lecture seule) |
|----------|---------------------------------------------------|
| Non-atomicité signature + activation | Envelopper `signAdhesion` + `activateMemberFromRequest` dans une `runTransaction` ou un `writeBatch` unique ; ou rendre `activateMemberFromRequest` idempotent et vérifier l'état avant d'agir |
| Acceptation sans activation | Soit interdire `status: 'accepted'` sans activation dans la règle Firestore, soit exiger que `signAdhesion` soit le seul chemin vers `accepted` |
| Activation sans demande validée | `setStatus(uid,'active')` doit exiger l'existence d'une `adhesionRequests/{uid}` en statut `accepted` avant d'activer |
| Double validation | Dans `signAdhesion`, vérifier que `req.status` est `pending` ou `needs_completion` avant de passer à `accepted` ; côté Firestore, n'autoriser la transition vers `accepted` que depuis `pending`/`needs_completion` |
| Collision compteur absent | L'admin principal doit initialiser `counters/memberNumbers` (migration) ; un sous-admin ne doit jamais initialiser à partir de 1 si des membres existent. Prévoir une lecture protégée ou un seed côté serveur. |
| `next = 1` refusé | Ajuster le code pour écrire systématiquement `next >= 2` à la création, ou assouplir la règle pour accepter `next >= 1` avec contrainte `lastMemberNo` cohérent |
| `structureId` dans application | Ajouter `structureId` à `adhesionAppKeys()` (firestore.rules:520-524) avec validation ; optionnel pour l'existant, obligatoire pour le neuf |
| `validatedBy` / `validatedAt` / `validatedByRole` | Ajouter à la liste `hasOnly` de l'update racine (firestore.rules:641) : `['status', 'adminNote', 'adminSignature', 'signedBy', 'signedAt', 'validatedBy', 'validatedAt', 'validatedByRole', 'updatedAt']` ; réserver l'écriture à `isAdmin()` ou `isSubAdminOf()` ; interdire au demandeur |
| `isSubAdminLocal()` / structure | Créer fonction `isSubAdminLocal()` (membre actif, `role == 'subadminLocal'`) et `assignedLocalStructure()` ; règles `members/{uid}` et `counters/memberNumbers` étendues pour inclure `isSubAdminLocal()` avec contrainte de structure |
| Contre-audit OU/ET | Remplacer `role != 'subadmin' || role != 'subadminLocal'` par `role != 'subadmin' && role != 'subadminLocal'` (firestore.rules:178) |

### 5.5 Tests positifs nécessaires

| Test | Description | Résultat attendu |
|------|-------------|-----------------|
| T1 | `signAdhesion` sur demande `pending` → statut `accepted` + membre créé avec `memberNo` | Succès, membre actif, numéro unique |
| T2 | `updateAdhesionStatus` → `accepted` sans appel à `activateMemberFromRequest` | Adhésion `accepted`, aucun membre créé (comportement actuel à documenter) |
| T3 | `setStatus(uid,'active')` sur membre sans demande d'adhésion | Doit être **refusé** après correction (actuellement accepté) |
| T4 | Deux `signAdhesion` concurrents sur même demande | Un seul succès, le second voit statut déjà `accepted` |
| T5 | Compteur absent, création par admin | `next >= 2`, `lastMemberNo` cohérent avec le membre créé |
| T6 | Compteur absent, création par sous-admin | Doit être refusé ou initialiser avec un seed sûr (pas de `SM-0001` si membres existent) |
| T7 | `application.structureId` dans nouvelle demande | Accepté si `structureId` ajouté à `adhesionAppKeys()` |
| T8 | `validatedBy` / `validatedAt` / `validatedByRole` par admin sur demande | Accepté si ajouté à `hasOnly` update racine |
| T9 | `validatedBy` par le demandeur lui-même | **Refusé** par les règles |
| T10 | `role != 'subadmin' && role != 'subadminLocal'` | `subadminLocal` ne peut pas s'auto-supprimer ; `member` classique peut |

### 5.6 Tests négatifs nécessaires

| Test | Description | Résultat attendu |
|------|-------------|-----------------|
| N1 | `signAdhesion` sur demande déjà `accepted` | Refusé (double validation bloquée) |
| N2 | `setStatus(uid,'active')` sans `adhesionRequests` accepté | Refusé |
| N3 | Sous-admin active membre d'une autre province | Refusé (règle `prov == assignedProvince()`) |
| N4 | `next = 1` à la création du compteur | Refusé (règle `next >= 2`) |
| N5 | Demandeur ajoute `validatedBy` sur sa demande | Refusé |
| N6 | `subadminLocal` s'auto-supprime avec la règle OU erronée | Autorisé (démontre le bug de la règle OU) |
| N7 | `subadminLocal` s'auto-supprime avec la règle ET corrigée | Refusé |
| N8 | `structureId` absent dans nouvelle demande (si obligatoire) | Refusé |

---

## 6. CONCLUSION

### 6.1 Les trois points bloquants sont-ils résolus conceptuellement ?

**Point 1 — Circuit de validation :** Les risques sont identifiés (non-atomicité, acceptation sans activation, activation sans validation, double validation). Des solutions conceptuelles existent (transaction unique, vérification de statut, liaison demande→membre) mais **aucune n'est implémentée**. Le projet peut passer à la préparation du développement **à condition** d'intégrer ces corrections avant tout codage.

**Point 2 — Compteur global SM-XXXX :** Les risques sont identifiés (collision si compteur absent + sous-admin, `next >= 2`, pas d'unicité globale garantie par getAfter, sous-admin sans accès global members). Une solution conservant une numérotation globale unique existe : initialisation du compteur par l'admin principal, transaction sérialisée sur le compteur, `getAfter` conservé mais complété par une vérification d'unicité côté application si nécessaire. **Non implémenté encore.**

**Point 3 — Schéma et règles des adhésions :** `structureId`, `validatedBy`, `validatedAt`, `validatedByRole` sont tous refusés par les `hasOnly()` actuels. Des modifications de règles sont nécessaires (ajout aux listes autorisées). **Non implémenté.**

**Point 4 — Contre-audit :** Le bug logique (OU au lieu de ET) est identifié et la correction est connue. **Non appliqué.**

### 6.2 Le projet peut-il passer à la préparation du développement ?

**OUI, conceptuellement.** Tous les trois points bloquants sont maintenant analysés, les risques documentés et les solutions recommandées. Le passage à la préparation du développement est possible **à condition** que :

1. Aucune modification de fichier ne soit faite dans le cadre de cet audit (lecture seule respectée).
2. Les corrections recommandées (transaction unique pour signature+activation, ajout des champs de schéma, correction de la logique OU/ET, initialisation sécurisée du compteur) soient intégrées au cahier des charges de développement.
3. Une autorisation expresse soit donnée avant toute modification de `cloud.js`, `firestore.rules`, `app.html` ou `data.js`.

### 6.3 Rappel de contrainte

**AUCUN FICHIER MODIFIÉ. AUCUNE ÉCRITURE. AUCUN DÉPLOIEMENT.** Ce rapport est purement d'analyse. Attendre une autorisation expresse avant de commencer le développement.
