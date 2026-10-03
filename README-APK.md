# UGTM Souss-Massa — Android APK

Ce dépôt contient la version web de l'application UGTM préparée pour une compilation Android avec Capacitor et GitHub Actions.

## 1. Préparer le dépôt GitHub

Créer un dépôt GitHub puis envoyer le contenu de ce dossier à la branche `main`.

## 2. Configurer les secrets du dépôt

Le workflow `Build Android APK` a besoin de 5 secrets dans GitHub (`Settings > Secrets and variables > Actions`) :

| Secret | Contenu |
|---|---|
| `GOOGLE_SERVICES_JSON` | Contenu intégral du fichier `google-services.json` téléchargé depuis Firebase (Projet > Paramètres > Vos applications > Android) |
| `ANDROID_KEYSTORE_BASE64` | Keystore de release encodé en base64 (`base64 -w 0 ugtm-release.keystore`) |
| `ANDROID_KEYSTORE_PASSWORD` | Mot de passe du keystore |
| `ANDROID_KEY_ALIAS` | Alias de la clé dans le keystore |
| `ANDROID_KEY_PASSWORD` | Mot de passe de la clé |

Important : enregistrez dans Firebase l'empreinte SHA-1 du keystore de release, pas celle d'un keystore debug. Sinon Google Sign-In échouera dans l'APK.

Pour afficher l'empreinte du keystore :

```bash
keytool -list -v -keystore ugtm-release.keystore
```

## 3. Générer un keystore localement

Pour créer un keystore de test/production localement :

```bash
chmod +x scripts/create-release-keystore.sh
./scripts/create-release-keystore.sh
```

Par défaut le fichier est créé dans `android/ugtm-release.keystore` avec l'alias `ugtm`.

## 4. Compiler localement

### Installation et synchronisation

```bash
npm install
npm run android:sync
```

### Ouvrir dans Android Studio

```bash
npm run android:open
```

### Compiler le debug APK localement

```bash
npm run android:build
```

### Compiler le release APK localement

```bash
npm run android:build:release
```

### Script dédié

```bash
chmod +x scripts/build-android-release.sh
./scripts/build-android-release.sh
```

L'APK générée se trouve dans :

```text
android/app/build/outputs/apk/release/app-release.apk
```

## 5. Build automatique via GitHub Actions

Après le push, ouvrir l'onglet `Actions` puis sélectionner `Build Android APK`.

Le workflow se déclenche automatiquement sur `main` et `master`, puis construit un APK release signé et le publie comme artifact `UGTM-Android-APK`.

## 6. Vérifications avant publication

Avant de publier l’APK, vérifier :

- `google-services.json` est bien présent dans le bon dossier Android
- le keystore de release est bien configuré
- le SHA-1 Firebase correspond bien au keystore de release
- le signing Gradle est configuré
- l’application démarre sans crash sur un émulateur ou un appareil
- la connexion Google fonctionne
- les règles Firestore sont bien sécurisées

## 7. Pour aller plus loin (Google Play)

Pour une publication Google Play, il faudra créer un Android App Bundle signé (`bundleRelease`) avec le même keystore de release.

Le répertoire `android/` est généré par le workflow et par Capacitor ; ne le commitez pas dans un projet de production final s’il est généré localement, sauf si votre workflow le gère explicitement.

## 8. Recommandations de production

- Utiliser un keystore sécurisé et non exposé dans le dépôt
- Ne pas committer les secrets ni `google-services.json`
- Vérifier les règles Firestore sur les collections `members`, `reports`, `news`, `events` et `responsables`
- Tester sur plusieurs appareils Android et versions du système
- Vérifier que toutes les permissions sont demandées uniquement si nécessaires
