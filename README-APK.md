# UGTM Souss-Massa — Android APK

Ce dépôt contient la version web de l'application UGTM préparée pour une
compilation Android avec Capacitor et GitHub Actions.

## 1. Mettre le projet sur GitHub

Créer un dépôt GitHub puis envoyer **le contenu de ce dossier** à la branche `main`.

## 2. Compiler l'APK

Après le push, ouvrir l'onglet **Actions** du dépôt et sélectionner
**Build UGTM Android APK**. Le workflow construit automatiquement un APK
debug et le publie comme *Artifact*.

## 3. Récupérer l'APK

Dans l'exécution terminée du workflow, ouvrir les *Artifacts* et télécharger
`ugtm-souss-massa-apk`. Le fichier à installer est `app-debug.apk`.

## Important

Pour une publication Google Play, il faudra ensuite créer une version
signée (AAB) avec une clé de signature. Cette étape est distincte du premier
APK de test.
