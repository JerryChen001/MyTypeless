#!/bin/bash
# 编译内置语音识别引擎：whisper.cpp 的 whisper-server（MIT），静态链接 + Metal 着色器内嵌，
# 产物 native/bin/mt-whisper 只依赖系统库，随包放进 Resources/bin/。
# 需要：git、cmake（brew install cmake）、Xcode Command Line Tools。
set -euo pipefail
WHISPER_VERSION="v1.9.5"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$DIR/.vendor/whisper.cpp"
BUILD="$SRC/build-mt"
OUT="$DIR/native/bin"
STAMP="$OUT/.mt-whisper-version"

if [ -x "$OUT/mt-whisper" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$WHISPER_VERSION" ] && [ "${1:-}" != "--force" ]; then
  echo "mt-whisper $WHISPER_VERSION 已存在（--force 重新编译）"
  exit 0
fi
command -v cmake >/dev/null || { echo "缺少 cmake：brew install cmake" >&2; exit 1; }

if [ ! -d "$SRC/.git" ]; then
  git clone --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp.git "$SRC"
else
  git -C "$SRC" fetch --depth 1 origin tag "$WHISPER_VERSION"
  git -C "$SRC" checkout -q "$WHISPER_VERSION"
fi

cmake -S "$SRC" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DGGML_BLAS=ON \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_BUILD_SERVER=ON \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_SDL2=OFF \
  -DWHISPER_CURL=OFF
cmake --build "$BUILD" --config Release --target whisper-server -j "$(sysctl -n hw.ncpu)"

mkdir -p "$OUT"
cp "$BUILD/bin/whisper-server" "$OUT/mt-whisper"
strip -x "$OUT/mt-whisper"
codesign --force --sign - "$OUT/mt-whisper" >/dev/null
echo "$WHISPER_VERSION" > "$STAMP"
echo "mt-whisper $WHISPER_VERSION → $OUT/mt-whisper"
