#!/usr/bin/env bash
# 轻卡账本 · 本地出包（aapt + javac + dx + apksigner，无 Gradle）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

AAPT=/usr/bin/aapt
RES_JAR=/usr/lib/android-sdk/platforms/android-23/android.jar
JAVA_JAR="$ROOT/platform/android-35.jar"
DX=/usr/lib/android-sdk/build-tools/debian/dx
KS="$ROOT/keystore/kcal-release.jks"

rm -rf build
mkdir -p build/classes build/gen apk/src/main/assets/www

# 1) 网页资源：web/ 是唯一源，复制进 assets
cp web/index.html apk/src/main/assets/www/index.html
cp web/app.css apk/src/main/assets/www/app.css
cp web/app.js apk/src/main/assets/www/app.js
cp web/foods.js apk/src/main/assets/www/foods.js
rm -rf apk/src/main/assets/www/vendor
cp -a web/vendor apk/src/main/assets/www/vendor

# 2) 生成带包名/版本号的 manifest
python3 - "$ROOT" <<'PY'
import json, sys, re, pathlib
root = pathlib.Path(sys.argv[1])
v = json.loads((root/"version.json").read_text())
m = (root/"apk/AndroidManifest.xml").read_text()
m = m.replace("<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">",
  f'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.nordic.kcal" android:versionCode="{v["versionCode"]}" android:versionName="{v["versionName"]}">', 1)
assert 'package="com.nordic.kcal"' in m, "manifest 已带 package，检查 generate 逻辑"
uses_sdk = f'    <uses-sdk android:minSdkVersion="{v["minSdk"]}" android:targetSdkVersion="{v["targetSdk"]}" />\n'
m = m.replace(">", ">\n" + uses_sdk, 1) if False else m
# 在 </manifest> 前插入 uses-sdk（放在 application 前更规范，但 aapt 都接受）
m = m.replace("    <uses-permission", uses_sdk + "    <uses-permission", 1)
(root/"build/AndroidManifest.xml").write_text(m)
PY

# 3) 资源 + assets 打包
"$AAPT" package -f -M build/AndroidManifest.xml -S apk/src/main/res \
  -A apk/src/main/assets -I "$RES_JAR" -J build/gen -F build/base.apk

# 4) 编译 Java
find apk/src/main/java build/gen -name '*.java' > build/sources.txt
javac -source 8 -target 8 -encoding UTF-8 -Xlint:-options -bootclasspath "$JAVA_JAR" \
  -d build/classes @build/sources.txt

# 5) dex
"$DX" --dex --output=build/classes.dex build/classes

# 6) 合成 APK
cp build/base.apk build/unsigned.apk
(cd build && zip -q -j unsigned.apk classes.dex)
zipalign -f 4 build/unsigned.apk build/aligned.apk

# 7) 签名
# 签名口令只从本机环境读取，不写进仓库
if [ -f "$HOME/.kcal_build_env" ]; then
  . "$HOME/.kcal_build_env"
fi
: "${KCAL_KS_PASS:?请先设置 KCAL_KS_PASS（签名口令），或写入 ~/.kcal_build_env}"
apksigner sign --ks "$KS" --ks-pass "env:KCAL_KS_PASS" --ks-key-alias kcal \
  --key-pass "env:KCAL_KS_PASS" --out build/kcal-signed.apk build/aligned.apk

apksigner verify --print-certs build/kcal-signed.apk | head -3
ls -lh build/kcal-signed.apk
