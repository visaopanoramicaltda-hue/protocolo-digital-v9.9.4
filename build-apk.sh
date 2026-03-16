#!/usr/bin/env bash
# ==============================================================================
# build-apk.sh — Automated APK Build via Bubblewrap (TWA)
# Protocolo Inteligente v9.9.4
#
# Prerequisites:
#   - Node.js >= 18
#   - Java JDK 17+ (JAVA_HOME must be set)
#   - Android SDK (ANDROID_HOME must be set, or Bubblewrap will download it)
#
# Usage:
#   chmod +x build-apk.sh
#   ./build-apk.sh
#
# Environment Variables (optional):
#   KEYSTORE_PASS  — Keystore password (default: protocolo123)
# ==============================================================================

set -euo pipefail

# -------------------------------- CONFIG --------------------------------------
APP_NAME="Protocolo Inteligente"
PACKAGE_ID="com.protocolointeligente.app"
HOST="protocolo-digital-v9-9-4-357145329416.southamerica-east1.run.app"
MANIFEST_URL="https://${HOST}/manifest.webmanifest"
TWA_DIR="twa-output"
KEYSTORE_FILE="android.keystore"
KEYSTORE_ALIAS="protocolo-inteligente"
KEYSTORE_PASS="${KEYSTORE_PASS:-protocolo123}"
# ------------------------------------------------------------------------------

echo "============================================"
echo "  ${APP_NAME} — APK Builder (TWA)"
echo "============================================"
echo ""

# 1) Check dependencies
echo "[1/6] Checking dependencies..."

if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install Node.js >= 18."
  exit 1
fi

if ! command -v java &>/dev/null; then
  echo "ERROR: Java JDK not found. Install JDK 17+ and set JAVA_HOME."
  exit 1
fi

if [ -z "${ANDROID_HOME:-}" ]; then
  echo "WARNING: ANDROID_HOME not set. Bubblewrap will attempt to download Android SDK."
fi

echo "  Node.js: $(node --version)"
echo "  Java:    $(java -version 2>&1 | head -1)"
echo ""

# 2) Install Bubblewrap CLI
echo "[2/6] Installing Bubblewrap CLI..."
if ! command -v bubblewrap &>/dev/null; then
  npm install -g @bubblewrap/cli
fi
echo "  Bubblewrap: $(bubblewrap --version 2>/dev/null || echo 'installed')"
echo ""

# 3) Generate signing keystore (if not exists)
echo "[3/6] Checking signing keystore..."
if [ ! -f "${KEYSTORE_FILE}" ]; then
  echo "  Generating new keystore: ${KEYSTORE_FILE}"
  keytool -genkeypair \
    -alias "${KEYSTORE_ALIAS}" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -keystore "${KEYSTORE_FILE}" \
    -storepass "${KEYSTORE_PASS}" \
    -keypass "${KEYSTORE_PASS}" \
    -dname "CN=${APP_NAME}, OU=Mobile, O=Protocolo Inteligente, L=Sao Paulo, ST=SP, C=BR"
  echo ""
  echo "  SHA-256 Fingerprint (update assetlinks.json with this):"
  keytool -list -v -keystore "${KEYSTORE_FILE}" -alias "${KEYSTORE_ALIAS}" \
    -storepass "${KEYSTORE_PASS}" 2>/dev/null | grep "SHA256:" || true
  echo ""
else
  echo "  Using existing keystore: ${KEYSTORE_FILE}"
fi
echo ""

# 4) Initialize TWA project
echo "[4/6] Initializing TWA project..."
rm -rf "${TWA_DIR}"
mkdir -p "${TWA_DIR}"
cd "${TWA_DIR}"

bubblewrap init \
  --manifest="${MANIFEST_URL}" \
  --directory=.

echo ""

# 5) Build APK
echo "[5/6] Building signed APK..."
bubblewrap build \
  --signingKeyPath="../${KEYSTORE_FILE}" \
  --signingKeyAlias="${KEYSTORE_ALIAS}"

echo ""

# 6) Output
echo "[6/6] Build complete!"
echo ""

APK_FILE=$(find . -name "*.apk" -type f | head -1)
if [ -n "${APK_FILE}" ]; then
  APK_SIZE=$(du -h "${APK_FILE}" | cut -f1)
  echo "============================================"
  echo "  APK Generated Successfully!"
  echo "  File: ${TWA_DIR}/${APK_FILE}"
  echo "  Size: ${APK_SIZE}"
  echo "============================================"
  echo ""
  echo "Next steps:"
  echo "  1. Update public/.well-known/assetlinks.json with your SHA-256 fingerprint"
  echo "  2. Deploy the web app to Cloud Run"
  echo "  3. Upload APK to Google Play Console"
  echo "  4. Test with: adb install ${APK_FILE}"
else
  echo "WARNING: No APK file found. Check build output above."
  exit 1
fi

