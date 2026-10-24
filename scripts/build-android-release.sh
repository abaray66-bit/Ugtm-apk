#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -f "$ROOT_DIR/package.json" ]; then
  echo "ERREUR : package.json introuvable dans $ROOT_DIR" >&2
  exit 1
fi

if [ ! -f "$ROOT_DIR/package-lock.json" ]; then
  echo "ERREUR : package-lock.json introuvable ; build reproductible impossible" >&2
  exit 1
fi

cd "$ROOT_DIR"
echo "Installation des dépendances verrouillées..."
npm ci

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
