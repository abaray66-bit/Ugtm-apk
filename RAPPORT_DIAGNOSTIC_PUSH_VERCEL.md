# Diagnostic — Backend push Vercel (frontend ↔ serveur)

## Synthèse

Le backend est **déployé et joignable**. Le `404 NOT_FOUND` observé concernait la
**racine du domaine** (`/`), pas la fonction `api/send-push.js`. En revanche, un
défaut réel a été trouvé : une erreur de configuration Firebase Admin était
renvoyée au client comme un **401 Unauthorized**, donc invisible.

## 1. Le frontend envoie-t-il une requête POST à la bonne adresse ?

Oui. Vérifié en reconstruisant l'URL exactement comme `www/cloud.js` :

```
URL construite par cloud.js : https://agile-marimba-ow7rjs2.vercel.app/api/send-push
POST réel                 : HTTP 401 {"error":"Unauthorized"}
ACAO                      : https://ugtm-fns-souss-massa.web.app
```

Chaîne vérifiée : `APP_DATA.firebase.pushBackendUrl` (data.js:22) + `/api/send-push`
(cloud.js), méthode `POST`, en-têtes `Authorization: Bearer <ID token>` et
`Content-Type: application/json`.

Attention : **l'application réelle ne lit pas le data.js du dépôt**. Firebase
Hosting sert encore l'ancienne valeur :

```
https://ugtm-fns-souss-massa.web.app/data.js  ->  pushBackendUrl: "...tmp.now"
```

Tant que Firebase Hosting n'est pas redéployé, la production continue d'appeler
l'adresse temporaire. Un push de `main` déclenche `.github/workflows/deploy-hosting.yml`.

## 2. Le serveur accepte-t-il l'origine réelle de l'application (CORS) ?

Oui, mesuré sur le préflight `OPTIONS /api/send-push` du déploiement :

| Origine envoyée | Préflight | `Access-Control-Allow-Origin` |
|---|---|---|
| `https://ugtm-fns-souss-massa.web.app` | 204 | renvoyé |
| `https://ugtm-fns-souss-massa.firebaseapp.com` | 204 | renvoyé |
| `https://localhost` (APK Android) | 204 | renvoyé |
| `capacitor://localhost` (APK iOS) | 204 | renvoyé |
| `http://localhost` (dev) | 204 | renvoyé |
| `https://evil.example` | 204 | **absent** (refus, comportement voulu) |

Ajout : `https://agile-marimba-ow7rjs2.vercel.app` rejoint la liste autorisée,
puisque `vercel.json` fait aussi servir l'application par ce domaine.

## 3. Firebase Admin s'initialise-t-il correctement ?

**Cela ne pouvait pas être vérifié sur l'ancien déploiement** : `getFirebaseApp()`
était appelé *à l'intérieur* du `try` de `verifyIdToken`, donc toute erreur de
secret produisait un `401` identique à un jeton invalide.

Corrections dans `api/send-push.js` :

- `parseServiceAccount()` valide la présence, le JSON, `client_email` et `private_key`
  et renvoie une erreur explicite (jamais un 401).
- Initialisation isolée : échec → **500** `{"error":"Server misconfigured","code":"firebase_init_failed"}`.
- `FCM_PROJECT_ID` manquant → **500** `{"code":"fcm_config_incomplete"}`.
- `verifyIdToken` échoue → **401** avec le code Firebase (`auth/id-token-expired`, etc.).

Nouvelle sonde publique sans secret : `GET /api/health`

```json
{ "ok": true,
  "checks": { "serviceAccount": true, "projectId": true, "adminSdk": true, "oauthToken": true } }
```

`oauthToken` fait une vraie signature JWT + échange auprès de Google : c'est la
preuve que la clé privée Vercel est valide et autorisée pour FCM. `503` sinon,
avec le code fautif dans `errors`.

## 4. Erreurs visibles au lieu d'être masquées

- Serveur : chaque échec journalise un JSON `{level, event, reason/detail, code}`
  dans les logs Vercel (config, jeton, droits, rate limit, envoi FCM).
- Client : `cloudSendPush()` n'avale plus la réponse ; tout statut ≠ 2xx est
  affiché dans la console avec l'URL et le corps (`push backend 403 ...`).
- `tools/check-syntax.js` vérifie désormais aussi `api/send-push.js` et `api/health.js`,
  et bloque le déploiement Firebase Hosting en cas d'erreur de syntaxe.

## Réglages Vercel à conserver

- **Root Directory** : racine du dépôt (vide) — sinon `api/` n'est pas déployé.
- **Framework Preset** : Other, **Build Command** vide.
- Variables (Production) : `FCM_SERVICE_ACCOUNT`, `FCM_PROJECT_ID`
  (`ugtm-fns-souss-massa`), `ADMIN_EMAILS`.

## À faire après redéploiement

```bash
B=https://agile-marimba-ow7rjs2.vercel.app
curl -s "$B/api/health"          # ok:true attendu
curl -s -o /dev/null -w "%{http_code}\n" "$B/"                        # 200
curl -s -o /dev/null -w "%{http_code}\n" "$B/firebase-messaging-sw.js" # 200
curl -s https://ugtm-fns-souss-massa.web.app/data.js | grep pushBackendUrl  # URL permanente
```

Puis, depuis l'espace administrateur, publier un communiqué et vérifier dans la
console : `push backend ...` ne doit plus apparaître, et les logs Vercel doivent
montrer `event: push_sent` avec `successCount > 0`.
