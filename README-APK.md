# UGTM Souss-Massa — Android APK

Ce dépôt contient la version web de l'application UGTM préparée pour une compilation Android avec Capacitor et GitHub Actions.

## 1. Mettre le projet sur GitHub

Créer un dépôt GitHub puis envoyer **le contenu de ce dossier** à la branche `main`.

## 2. Configurer les secrets du dépôt

Le workflow **Build Android APK** a besoin de 5 secrets
(GitHub > Settings > Secrets and variables > Actions) :

| Secret | Contenu |
|---|---|
| `GOOGLE_SERVICES_JSON` | Contenu intégral du fichier `google-services.json` téléchargé depuis Firebase (Projet > Paramètres > Vos applications > Android) |
| `ANDROID_KEYSTORE_BASE64` | Keystore de **release** encodé en base64 (`base64 -w 0 ugtm-release.keystore`) |
| `ANDROID_KEYSTORE_PASSWORD` | Mot de passe du keystore |
| `ANDROID_KEY_ALIAS` | Alias de la clé dans le keystore |
| `ANDROID_KEY_PASSWORD` | Mot de passe de la clé |

Important : enregistrez dans Firebase (Paramètres du projet > Vos applications >
Android > Ajouter une empreinte SHA-1) l'empreinte **du keystore de release** —
pas celle d'un keystore debug — sinon la connexion Google échouera dans l'APK.
Pour afficher l'empreinte : `keytool -list -v -keystore ugtm-release.keystore`.

## 3. Compiler l'APK

Après le push, ouvrir l'onglet **Actions** du dépôt et sélectionner
**Build Android APK** (le workflow se déclenche aussi automatiquement à chaque
push sur `main`). Il construit un **APK release signé** et le publie comme
*Artifact* `UGTM-Android-APK`.

## 4. Récupérer l'APK

Dans l'exécution terminée du workflow, ouvrir les *Artifacts* et télécharger
`UGTM-Android-APK`. Le fichier à installer est `app-release.apk`.

## 5. Publication Android de production

Avant la publication, il faut vérifier les éléments suivants :

- `google-services.json` est bien présent
- le SHA-1 du keystore de release est ajouté dans Firebase
- le package Android est bien `ma.ugtm.souss.massa`
- le keystore de release est valide et signé
- la version Android est définie (`versionCode`, `versionName`)
- les permissions Android sont justifiées
- les règles Firestore sont sécurisées
- le build release est validé sur un appareil réel

Pour la procédure détaillée, voir `README-PUBLISH.md`.

## Pour aller plus loin (Google Play)

Pour une publication Google Play, il faudra créer un Android App Bundle
signé (`bundleRelease` → fichier `.aab`) avec le même keystore de release.
Le fichier `android/` est regénéré par le workflow : ne le commitez pas
(il figure dans `.gitignore`).
