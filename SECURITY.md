# 安全说明

## 数据存在哪

- 账本、体重、饮水等数据保存在本机 WebView 的 localStorage
- 没有账号系统、没有自建服务器、没有埋点上报
- 只有调用 AI 时，才会把当次提示词/图片发给你配置的服务商

## API Key

- API Key 使用 Android Keystore 的 AES-256-GCM 加密，密文存在本机 SharedPreferences
- 导出备份、迁移码、自动备份都会剔除 API Key
- 请不要在 Issue、截图、日志里贴出完整 API Key

## 报告漏洞

请使用 GitHub 的 **Private vulnerability reporting / Security advisory**（仓库 Security 页面），不要开公开 Issue。

## 已知边界

- 数据只在本机，卸载前请先导出备份
- 自动备份不含 API Key
- 本项目不提供医疗建议，营养数据为参考/估算值
