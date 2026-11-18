# 贡献指南

感谢你愿意帮忙测试和改进「轻卡账本」。这是一个个人项目，优先保证「小、稳、离线可用」。

## 先提 Issue，再提 PR

- Bug：用 Bug 模板，附机型 / ROM / 版本 / 复现步骤 / 截图
- 新功能：先开 Issue 描述场景，避免做完才发现方向不对
- 小修（文案、样式、明显 bug）可以直接 PR

## 本地开发

```bash
# 依赖：openjdk-17-jdk-headless aapt zipalign apksigner dalvik-exchange unzip zip
# 资源链接用 API 23 的 android.jar；javac 用 API 35 的 android.jar
export KCAL_KS_PASS='你的签名口令'
./build.sh
node test-core.js
```

- 网页：`web/index.html` / `app.css` / `app.js` / `foods.js`
- 原生壳：`apk/src/main/java/com/nordic/kcal/`
- 构建说明：`BUILD.md`

## 不要提交

- `keystore/`（签名密钥）
- `build/`、`apk/src/main/assets/www/`（生成物）
- 带真实 API Key、账本数据、体重的截图或备份
- 任何 `project*.tar.gz`（里面含签名密钥）

## 代码风格

- 前端不引入构建工具，保持单页 + 原生 JS
- 颜色优先用 `var(--kcal-*)`；JS 用 `KC` 常量
- 文案用中文，口语、简短，不写医疗建议
- 新增功能请补 `test-core.js` 断言

## PR 检查

- [ ] `node test-core.js` 全绿
- [ ] `./build.sh` 能出包
- [ ] 没有提交密钥、构建产物、个人数据
- [ ] 截图已确认不含真实体重/账本
