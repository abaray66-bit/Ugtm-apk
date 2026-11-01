#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -f "$ROOT_DIR/package.json" ]; then
  echo "ERREUR : package.json introuvable dans $ROOT_DIR"
  exit 1
fi

cd "$ROOT_DIR"

if [ ! -d node_modules ]; then
  echo "Installation des dépendances..."
  npm install
fi

if [ ! -d android ]; then
  echo "Génération du projet Android..."
  npx cap add android
fi

echo "Synchronisation Capacitor..."
npx cap sync android

echo "Compilation APK Release..."
cd android
chmod +x gradlew
./gradlew assembleRelease

echo ""
echo "APK générée :"
ls -lh "app/build/outputs/apk/release/app-release.apk"
