# Android 平台 jar

本地构建需要两个 `android.jar`，都不入库（体积大）：

- `platform/android-35.jar`：javac 的 bootclasspath
  - 可从 `Sable/android-platforms` 仓库的 `android-35/android.jar` 获取
  - 或从 Android SDK `platforms/android-35/android.jar` 复制
- API 23 的 `android.jar`：aapt 资源链接
  - `/usr/lib/android-sdk/platforms/android-23/android.jar`
  - 由 Debian/Ubuntu 的 Android SDK 工具包提供

`build.sh` 里这两个路径可按本机情况修改。
