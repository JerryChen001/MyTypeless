#!/bin/bash
# 本地自签名代码签名证书（只用于本机/内部测试分发）。
# 为什么需要：adhoc 签名没有固定身份，系统隐私权限（辅助功能/麦克风）按每次构建的 cdhash 认人，
# 每重新打包一次授权就失效。用固定证书签名后，指定要求变为“标识 + 证书”，重新打包授权仍有效。
# 证书与私钥放在项目内独立钥匙串（.vendor/ 已被 git 忽略），不改动登录钥匙串。
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIGN_DIR="$DIR/.vendor/signing"
KC="$SIGN_DIR/mytypeless-signing.keychain-db"
PASS="mytypeless-local"
NAME="MyTypeless Local Signing"

mkdir -p "$SIGN_DIR"
if [ ! -f "$KC" ]; then
  security create-keychain -p "$PASS" "$KC"
  security set-keychain-settings "$KC" # 不自动锁定
fi
security unlock-keychain -p "$PASS" "$KC"

if ! security find-certificate -c "$NAME" "$KC" >/dev/null 2>&1; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  cat > "$TMP/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF
  /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$TMP/cert.cnf" \
    -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
  /usr/bin/openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" \
    -out "$TMP/id.p12" -passout "pass:$PASS" 2>/dev/null
  security import "$TMP/id.p12" -k "$KC" -P "$PASS" -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PASS" "$KC" >/dev/null
  echo "已创建签名证书：$NAME"
fi
echo "$KC"
