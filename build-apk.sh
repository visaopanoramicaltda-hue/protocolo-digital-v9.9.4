#!/usr/bin/env bash
# =============================================================================
# build-apk.sh — Automated APK Build using Bubblewrap (TWA)
# =============================================================================
# This script builds a signed APK for the Protocolo Inteligente app
# using Google's Bubblewrap CLI (Trusted Web Activity).
#
# Prerequisites:
#   - Node.js >= 18
#   - Java JDK >= 17 (for signing)
#
# No Android Studio required.
# =============================================================================

set -euo pipefail

APP_URL="https://protocolo-digital-v9-9-4-357145329416.southamerica-east1.run.app"
PACKAGE_NAME="com.protocolointeligente.app"
APP_NAME="Protocolo Inteligente"
LAUNCHER_NAME="Protocolo"
VERSION_NAME="9.9.4"
VERSION_CODE=1
KEYSTORE_PATH="android.keystore"
KEY_ALIAS="protocolo-key"
KEYSTORE_PASSWORD="${KEYSTORE_PASSWORD:-android}"
OUTPUT_DIR="./twa-output"

echo "============================================"
echo "  Protocolo Inteligente — APK Builder (TWA)"
echo "============================================"
echo ""

# -----------------------------------------------------------
# Step 1: Install Bubblewrap CLI
# -----------------------------------------------------------
echo "[1/5] Installing Bubblewrap CLI..."
if ! command -v bubblewrap &> /dev/null; then
    npm install -g @nicolo-ribaudo/bubblewrap
    echo "  ✔ Bubblewrap installed"
else
    echo "  ✔ Bubblewrap already installed"
fi

# -----------------------------------------------------------
# Step 2: Create output directory
# -----------------------------------------------------------
echo "[2/5] Setting up output directory..."
mkdir -p "$OUTPUT_DIR"
cd "$OUTPUT_DIR"
echo "  ✔ Output directory ready: $OUTPUT_DIR"

# -----------------------------------------------------------
# Step 3: Generate signing key (if not exists)
# -----------------------------------------------------------
echo "[3/5] Checking signing key..."
if [ ! -f "$KEYSTORE_PATH" ]; then
    echo "  Generating new signing keystore..."
    keytool -genkeypair \
        -alias "$KEY_ALIAS" \
        -keyalg RSA \
        -keysize 2048 \
        -validity 10000 \
        -keystore "$KEYSTORE_PATH" \
        -storepass "$KEYSTORE_PASSWORD" \
        -keypass "$KEYSTORE_PASSWORD" \
        -dname "CN=Protocolo Inteligente, OU=Dev, O=ProtocoloInteligente, L=SaoPaulo, ST=SP, C=BR"
    echo "  ✔ Keystore generated: $KEYSTORE_PATH"
    echo ""
    echo "  ⚠ IMPORTANT: Save this SHA-256 fingerprint for assetlinks.json:"
    keytool -list -v -keystore "$KEYSTORE_PATH" -alias "$KEY_ALIAS" -storepass "$KEYSTORE_PASSWORD" 2>/dev/null | grep "SHA256:"
    echo ""
else
    echo "  ✔ Keystore found: $KEYSTORE_PATH"
fi

# -----------------------------------------------------------
# Step 4: Initialize TWA project
# -----------------------------------------------------------
echo "[4/5] Initializing TWA project with Bubblewrap..."
bubblewrap init --manifest="$APP_URL/manifest.webmanifest" --directory=.
echo "  ✔ TWA project initialized"

# -----------------------------------------------------------
# Step 5: Build signed APK
# -----------------------------------------------------------
echo "[5/5] Building signed APK..."
bubblewrap build --directory=.
echo ""

# -----------------------------------------------------------
# Output
# -----------------------------------------------------------
APK_FILE=$(find . -name "*.apk" -type f | head -1)
if [ -n "$APK_FILE" ]; then
    echo "============================================"
    echo "  ✅ APK BUILD SUCCESSFUL"
    echo "============================================"
    echo "  APK: $APK_FILE"
    echo "  Size: $(du -h "$APK_FILE" | cut -f1)"
    echo ""
    echo "  Next steps:"
    echo "  1. Update public/.well-known/assetlinks.json with your SHA-256 fingerprint"
    echo "  2. Deploy the web app to Cloud Run"
    echo "  3. Upload the APK to Google Play Console"
    echo "============================================"
else
    echo "⚠ APK file not found. Check build output above for errors."
    exit 1
fi
