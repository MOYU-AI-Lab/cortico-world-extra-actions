# 发布说明

三件事：GitHub 仓库、npm 包、Coopanion 插件库。**第三步依赖第二步**（那个"库"就是 npm 源）。

先把下面命令里的 `DanieleWolfHOLO` 换成你的 GitHub 用户名。

## 1. GitHub

```bash
cd 深深与额外动作拓展-插件        # 本目录（或解压出来的 cortico-world-extra-actions）
git init -b main
git add .
git commit -m "feat: 深深与额外动作拓展 0.2.5"
git remote add origin https://github.com/DanieleWolfHOLO/cortico-world-extra-actions.git
git push -u origin main
```

仓库建议先建空的（不要勾 README），否则第一次 push 要 `git pull --rebase`。

打 Release（把 zip 挂上去，别人点链接就能下）：

```bash
git tag v0.2.5 && git push --tags
# 然后在 https://github.com/DanieleWolfHOLO/cortico-world-extra-actions/releases/new 选 v0.2.5，上传 zip
```

## 2. npm

```bash
npm login                 # 浏览器登录，仅第一次
npm publish --access public
```

包名 `cortico-world-extra-actions` 在 npm 上还没被占用（发包前可再确认一次）。
发布后地址：https://www.npmjs.com/package/cortico-world-extra-actions

发版流程（以后更新）：

```bash
npm version patch   # 或 minor / major；会顺带打 git tag
npm publish --access public
```

## 3. Coopanion 插件库

那个"库"不是独立站点，是宿主内的 **npm 搜索 + pnpm 安装**：

- 搜索：`GET /api/extensions/search` → `npm search`
- 安装：`pnpm add <包名>`（在 `data/extensions/` 里跑）
- 源：默认 npmjs；可在扩展页改成私有源（写 `data/extensions/.npmrc`）

所以第 2 步发布成功后，用户在 Coopanion 的扩展页搜 `cortico-world` 或 `深深` 就能看到它。
包在 `package.json` 里带了这个声明，宿主靠它识别扩展类型：

```json
"cortico": { "kind": "world", "api": 6, "webUiClient": "dist/webui.js" }
```

## 发布前自检

```bash
node tools/test_writer.mjs
node tools/test_security.mjs
node tools/test_importer.mjs
node tools/test_catalog.mjs
node tools/test_panel_guard.mjs
node tools/verify_installed.mjs <形象包目录>
npm pack --dry-run          # 确认打进去的文件（当前 9 个，tools 不进包）
```
