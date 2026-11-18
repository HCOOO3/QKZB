# 构建说明（本地，无 Gradle）

## 环境

- Ubuntu 24.04 proot（手机内）
- `openjdk-17-jdk-headless`、`aapt`（Android 14 beta）、`zipalign`、`apksigner`、`dalvik-exchange`（dx）、`zip`
- API 23 `android.jar`：`/usr/lib/android-sdk/platforms/android-23/android.jar`（资源链接）
- API 35 `android.jar`：`platform/android-35.jar`（javac bootclasspath，来自 Sable/android-platforms）

## 命令

```bash
./build.sh
```

脚本做的事：

1. 把 `web/index.html` 与 `web/vendor/` 复制进 `apk/src/main/assets/www/`
2. 读取 `version.json`，把 package / versionCode / versionName / uses-sdk 注入清单
3. `aapt package` 打资源与 assets（API 23 jar）
4. `javac -source 8 -target 8 -bootclasspath platform/android-35.jar`
5. `dx --dex` 生成 classes.dex
6. `zip` 合入 dex → `zipalign` → `apksigner sign`（keystore 复用）
7. 输出 `build/kcal-signed.apk`，并打印证书指纹

## 验证

```bash
aapt dump badging build/kcal-signed.apk | head -4
apksigner verify --print-certs build/kcal-signed.apk
```

证书 SHA-256 应为 `8e76d6be5fec64a502ea0d3aa4ba754ed90b1d746c8a8dd35f0cb69d2ce87a19`。
