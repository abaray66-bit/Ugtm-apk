# UGTM Souss-Massa — Android APK

Ce dépôt contient la version web de l'application, préparée pour une compilation Android avec Capacitor et GitHub Actions.

## Prérequis de sécurité

Avant toute compilation ou publication :

- ne jamais committer `google-services.json`, un keystore ou un mot de passe ;
- conserver les secrets uniquement dans **GitHub Actions > Settings > Secrets and variables > Actions** ;
- vérifier les règles Firestore avec l’émulateur avant déploiement ;
- tester les droits d’un utilisateur simple, d’un sous-administrateur et de l’administrateur ;
- ne pas considérer l’interface cliente comme une preuve de privilège : les règles Firestore restent l’autorité réelle ;
- révoquer immédiatement tout secret ou certificat accidentellement publié.

## Secrets GitHub Actions

Le workflow **Build Android APK** utilise les secrets suivants :

| Secret | Contenu |
|---|---|
| `GOOGLE_SERVICES_JSON` | Contenu intégral du fichier `google-services.json` téléchargé depuis Firebase |
| `ANDROID_KEYSTORE_BASE64` | Keystore release encodé en base64 (`base64 -w 0 ugtm-release.keystore`) |
| `ANDROID_KEYSTORE_PASSWORD` | Mot de passe du keystore |
| `ANDROID_KEY_ALIAS` | Alias de la clé dans le keystore |
| `ANDROID_KEY_PASSWORD` | Mot de passe de la clé |

Ne mettez jamais ces valeurs dans le code source, les logs ou les issues GitHub.

Important : ajoutez dans Firebase l’empreinte **SHA-1 du keystore release**, et non celle du keystore debug :

```bash
keytool -list -v -keystore ugtm-release.keystore
```

## Vérifications locales

```bash
npm ci
npm run check
npm run test:audit
npm run test:firestore
```

Le test Firestore nécessite les émulateurs Firebase. Si les tests échouent, ne publiez pas l’APK.

## Compiler l’APK

Après configuration des secrets, ouvrez l’onglet **Actions** du dépôt et lancez **Build Android APK**. Le workflow se déclenche également lors d’un push sur `main`.

Pour un build local :

```bash
npm ci
npm run android:sync
cd android
./gradlew assembleDebug
```

Pour une release signée :

```bash
npm run android:build:release
```

## Récupérer l’APK

Dans l’exécution terminée du workflow, ouvrez les **Artifacts** et téléchargez `UGTM-Android-APK`. Le fichier d’installation est `app-release.apk`.

## Publication de production

Avant publication, vérifiez :

- `google-services.json` est injecté uniquement par le workflow ;
- le SHA-1 du keystore release est enregistré dans Firebase ;
- le package Android est `ma.ugtm.souss.massa` ;
- le keystore release est sauvegardé dans un emplacement sûr ;
- `versionCode` et `versionName` ont été incrémentés ;
- les permissions Android sont justifiées ;
- les règles Firestore sont testées ;
- le build release est validé sur un appareil réel ;
- la connexion Google fonctionne avec le certificat release.

Pour Google Play, générez un Android App Bundle (`bundleRelease`) avec le même processus de signature. Le dossier `android/` est régénéré par le workflow et reste exclu du dépôt.
