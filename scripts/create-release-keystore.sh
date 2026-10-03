#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

KEYSTORE_PATH="${1:-$ROOT_DIR/android/ugtm-release.keystore}"
ALIAS="${ANDROID_KEY_ALIAS:-ugtm}"
STORE_PASSWORD="${ANDROID_KEYSTORE_PASSWORD:-changeit}"
KEY_PASSWORD="${ANDROID_KEY_PASSWORD:-changeit}"

mkdir -p "$(dirname "$KEYSTORE_PATH")"

keytool -genkeypair \
  -v \
  -keystore "$KEYSTORE_PATH" \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storetype PKCS12 \
  -storepass "$STORE_PASSWORD" \
  -keypass "$KEY_PASSWORD"

echo "Keystore créé : $KEYSTORE_PATH"
echo "Alias : $ALIAS"
echo "Mot de passe du magasin : $STORE_PASSWORD"
echo "Mot de passe de la clé : $KEY_PASSWORD"
echo ""
echo "Pour le build local ou GitHub Actions, exportez :"
echo "  export ANDROID_KEYSTORE_PASSWORD='$STORE_PASSWORD'"
echo "  export ANDROID_KEY_ALIAS='$ALIAS'"
echo "  export ANDROID_KEY_PASSWORD='$KEY_PASSWORD'"
