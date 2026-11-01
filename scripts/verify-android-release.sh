#!/usr/bin/env bash
set -euo pipefail

APK_PATH="${1:-android/app/build/outputs/apk/release/app-release.apk}"

if [ ! -f "$APK_PATH" ]; then
  echo "ERREUR : APK introuvable : $APK_PATH"
  echo "Lance d'abord : npm run android:build:release"
  exit 1
fi

echo "APK trouvé : $APK_PATH"

if [ -z "${ANDROID_HOME:-}" ]; then
  echo "ANDROID_HOME non défini. Configure le SDK Android avant la vérification."
  exit 1
fi

BUILD_TOOLS_DIR="$ANDROID_HOME/build-tools"
LATEST_TOOLS="$(ls "$BUILD_TOOLS_DIR" 2>/dev/null | sort -V | tail -1 || true)"

if [ -z "$LATEST_TOOLS" ]; then
  echo "ERREUR : aucun build-tools Android trouvé dans $BUILD_TOOLS_DIR"
  exit 1
fi

APKSIGNER="$ANDROID_HOME/build-tools/$LATEST_TOOLS/apksigner"

if [ ! -x "$APKSIGNER" ]; then
  echo "ERREUR : apksigner introuvable dans $APKSIGNER"
  exit 1
fi

echo "Vérification du certificat APK avec apksigner..."
"$APKSIGNER" verify --verbose --print-certs "$APK_PATH"

echo ""
echo "✅ Vérification terminée. L’APK est présent et signé s’il n’y a pas d’erreur ci-dessus."
