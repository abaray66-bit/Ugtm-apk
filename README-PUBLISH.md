# UGTM Souss-Massa — Publication Android

## 1. Prérequis

- Node.js 20+
- npm
- Android Studio
- Android SDK
- Java 21
- Firebase project configured
- Google Play Console access (si publication store)

## 2. Préparer le projet

```bash
npm install
npm run android:sync
```

## 3. Créer un keystore de release

```bash
keytool -genkeypair \
  -v \
  -keystore android/ugtm-release.keystore \
  -alias ugtm \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storetype PKCS12
```

Mémoriser :
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

## 4. Ajouter le SHA-1 Firebase

1. Ouvrir Firebase Console
2. Aller dans Project settings
3. Ajouter l’empreinte SHA-1 du keystore release
4. Télécharger `google-services.json`
5. Le placer dans :
   `android/app/google-services.json`

Important : le SHA-1 du keystore release est différent de celui du debug keystore.

## 5. Vérifier le package Android

Le package doit être :

```text
ma.ugtm.souss.massa
```

Vérifier dans :
- `capacitor.config.json`
- `android/app/build.gradle`

## 6. Compiler le release APK

```bash
npm run android:build:release
```

Le fichier APK est généré ici :

```text
android/app/build/outputs/apk/release/app-release.apk
```

## 7. Vérifier le certificat APK

```bash
$ANDROID_HOME/build-tools/<version>/apksigner verify --verbose android/app/build/outputs/apk/release/app-release.apk
```

## 8. Tester sur appareil réel

Tester :
- ouverture de l’application
- connexion Google
- profil utilisateur
- admin et sous-admin
- signalements
- actualités
- événements
- contacts
- liens et PDF

## 9. Règles Firebase

Vérifier que les règles Firestore sont strictes :
- membres : le membre ne peut modifier que son profil
- admin : toutes les données admin
- sous-admin : province limitée
- signalements : propriétaire ou admin uniquement
- news/events : lecture publique selon logique métier

## 10. Publication

Après validation :
- signer correctement
- générer le release APK
- tester sur vrai appareil
- publier sur Google Play ou via canal de diffusion interne

## 11. Vérification finale avant publication

- [ ] Build local OK
- [ ] Firebase Android OK
- [ ] google-services.json présent
- [ ] Keystore release OK
- [ ] SHA-1 Firebase OK
- [ ] Google Sign-In OK
- [ ] Firestore rules OK
- [ ] APK release signé OK
- [ ] Test réel OK
- [ ] Permissions OK
- [ ] Version et package OK
