# UGTM Souss-Massa — Publication Android

## 1. Prérequis

- Node.js 20+
- npm
- Android Studio
- Android SDK
- Java 21
- Projet Firebase configuré
- Accès Google Play Console si publication sur le store

## 2. Préparer le projet

Utilisez le lockfile pour installer exactement les versions validées :

```bash
npm ci
npm run android:sync
```

`npm ci` échoue volontairement si `package.json` et `package-lock.json` ne sont pas synchronisés.

## 3. Créer un keystore de release

```bash
keytool -genkeypair \\
  -v \\
  -keystore android/ugtm-release.keystore \\
  -alias ugtm \\
  -keyalg RSA \\
  -keysize 2048 \\
  -validity 10000 \\
  -storetype PKCS12
```

Conservez uniquement dans un gestionnaire de secrets : `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` et `ANDROID_KEY_PASSWORD`.

Ne commitez jamais de keystore, mot de passe ou fichier `google-services.json`.

## 4. Ajouter le SHA-1 Firebase

1. Ouvrir Firebase Console.
2. Aller dans **Project settings**.
3. Ajouter l’empreinte SHA-1 du keystore release.
4. Télécharger `google-services.json`.
5. Le placer uniquement en local dans `android/app/google-services.json` ou l’injecter via GitHub Actions.

Le SHA-1 du keystore release est différent de celui du keystore debug.

## 5. Vérifier le package Android

Le package doit être `ma.ugtm.souss.massa`. Vérifier `capacitor.config.json` et la configuration Android générée.

## 6. Compiler le release APK

```bash
npm run android:build:release
```

Le fichier APK est généré dans `android/app/build/outputs/apk/release/app-release.apk`.

## 7. Vérifier et tester

```bash
$ANDROID_HOME/build-tools/<version>/apksigner verify --verbose android/app/build/outputs/apk/release/app-release.apk
npm run test:firestore
```

Tester sur appareil réel l’ouverture, la connexion Google, les profils, les rôles, les signalements, les actualités, les événements, les contacts, les liens et les PDF.

## 8. Vérification finale

- [ ] `npm ci` OK
- [ ] Build local OK
- [ ] `google-services.json` non commité
- [ ] Keystore release et SHA-1 Firebase OK
- [ ] Google Sign-In OK
- [ ] Règles Firestore OK
- [ ] APK signée et vérifiée
- [ ] Test sur appareil réel OK
- [ ] Permissions, version et package vérifiés
