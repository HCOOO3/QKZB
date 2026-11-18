# 网页版 / PWA（鸿蒙 7、iOS、桌面浏览器）

APK 只能装在 Android / HarmonyOS 4 及以下；鸿蒙 7（NEXT）不再支持 APK。
这里提供一个 PWA，用浏览器打开即可，不需要上架应用市场。

## 开启 GitHub Pages

仓库已包含 `gh-pages` 分支（根目录就是 PWA）。在 GitHub 仓库：

**Settings → Pages → Build and deployment**

- Source：`Deploy from a branch`
- Branch：`gh-pages` / `(root)`
- Save

等 1–2 分钟，访问：

**https://hcooo3.github.io/QKZB/**

## 鸿蒙 7 上使用

1. 用华为浏览器打开上面的地址
2. 菜单 → 「添加到桌面」（不同版本叫「添加到主屏幕」）
3. 从桌面图标打开，接近独立 App
4. 首次使用到「设置 → 01 多模态接口配置」填 API Key

## 和 APK 的差别

| 能力 | APK | PWA |
| --- | --- | --- |
| 手动记账 / 食物库 / 钠 / 月报 | ✅ | ✅ |
| AI 识菜 / 文字补录 / 条码 | ✅ | ✅（浏览器允许跨域时） |
| 数据本地保存 | ✅ | ✅（按浏览器站点隔离） |
| API Key 加密 | Android Keystore | 浏览器 localStorage（安全性较弱） |
| 桌面小组件 | ✅ | ❌ |
| 通知栏快捷 / 后台提醒 | ✅ | ❌ |
| 自动备份到下载目录 | ✅ | ❌（用设置里的导出备份） |

## 注意

- 数据只存在当前浏览器里，换浏览器/清缓存会丢；请定期在设置里导出备份
- PWA 的 Service Worker 只缓存静态资源，不缓存 AI 请求
- 修改前端后需要更新 `pwa/sw.js` 里的 `CACHE` 版本号
- 鸿蒙浏览器如果不支持 Service Worker，页面仍可正常用，只是没有离线缓存
