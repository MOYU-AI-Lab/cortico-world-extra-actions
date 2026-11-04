# 🐟 奶糖特别留言 · 给 Daniele 的 DSH（Gitee 动作库托管方案）

> **【奶糖特别留言】** 这份文件是 Net-ang（奶糖_Net）留给 Daniele 的 DSH 的工作单。
> 如果你是自动化代理，请按「三、你要做的事」逐条执行，做完把结果回填到本文件末尾的清单里。
> 涉及素材上传，**不要动本仓库的任何代码和 release**。

---

## 一、为什么做这件事（数据说话）

| 指标 | 数值 | 来源 |
|---|---|---|
| 插件 npm 周下载 | **4,045** | `api.npmjs.org/downloads/point/last-week/cortico-world-extra-actions` |
| 完整动作库 Release 资产下载 | **75** | GitHub API：`releases/tags/library` → `shenshen-action-library.zip` |

比例约 **1.9%**。也就是说绝大多数装了插件的人，手上只有插件自带的 3 段示例动作，
面板里 102 条目录全是「库里没有 · 缺帧」，看起来像插件坏了。

根因不是产品，是**分发**：

- 动作库只放在 GitHub Release（370 MB 单包），**国内直连 github 基本不通**，必须代理；
- 只能整包下载，插件没法"缺哪段补哪段"，也做不了断点重试。

**结论：把 105 段动作库镜像到国内可直连的地方（Gitee），插件改成按文件增量下载。**

---

## 二、素材在哪

- GitHub Release：`https://github.com/MOYU-AI-Lab/cortico-world-extra-actions/releases/tag/library`
  → 资产 `shenshen-action-library.zip`（**370.15 MiB**，75 次下载，2026-11-03 07:10 更新）
- 该包里已经是**单文件高清格式**（不是帧序列），我核实过 zip 中央目录：
  **211 个条目 = 105 个 `anim.webp` + 105 个 `action.json` + 1 个 `actions/index.js`**，
  路径形如 `深深-动作库/actions/core/cheer-hop/anim.webp`

---

## 三、你要做的事

### 步骤 1：在 Gitee 建空仓库

- 地址：`https://gitee.com/projects/new`
- 仓库名建议：**`shenshen-action-library`**
- 可见性：**公开**（Gitee 公开仓库需要账号实名认证）
- **不要**勾选「使用 Readme 初始化」（要空仓库）
- 建完拿到仓库地址，形如 `https://gitee.com/<你的账号>/shenshen-action-library`

### 步骤 2：把素材推上去（目录结构必须如下）

**注意：`actions/` 必须在仓库根目录**，不要再套一层 `深深-动作库/`。
插件拼 URL 的规则是 `<raw-base>/actions/<分类>/<id>/anim.webp`，套多一层就全 404。

```
shenshen-action-library/          ← Gitee 仓库根
├─ actions/
│  ├─ index.js                     (来自压缩包里的 actions/index.js)
│  ├─ core/cheer-hop/{anim.webp,action.json}
│  ├─ eat/eat-dumplings/{anim.webp,action.json}
│  └─ …（共 105 个目录 / 10 个分类）
├─ MANIFEST.md                     (可选，逐段 id/帧数/大小/sha256)
└─ README.md                       (可选，说明这是给插件按文件取的库)
```

推送命令（**Gitee 直连不用代理**，账号密码或私人令牌都行）：

```bash
# 1) 解压现有资产包，把里面的「深深-动作库」内容平铺成 actions/
unzip shenshen-action-library.zip -d tmp
cd tmp/深深-动作库

# 2) 初始化并推到 Gitee
git init -b master
git add actions
git commit -m "feat: 深深动作库 105 段（640×360 单文件高清）"
git remote add origin https://gitee.com/<你的账号>/shenshen-action-library.git
git push -u origin master
```

### 步骤 3：验证直链可用（**必做**，raw 直链能不能取到是整个方案的前提）

```bash
curl -I "https://gitee.com/<你的账号>/shenshen-action-library/raw/master/actions/eat/eat-dumplings/anim.webp"
```

- 期望：`HTTP/1.1 200`，`Content-Length` ≈ 3734436（3.56 MB）
- 如果返回 302/403：把实际的重定向地址和状态码记下来 —— 插件端要按实际形态适配

### 步骤 4：把仓库地址交给插件

两种都行，二选一：

**A. 改配置（推荐，持久化）** — 编辑 `data/home/companion/config.json`：

```json
{ "worlds": { "extra-actions": { "downloadUrl": "https://gitee.com/<你的账号>/shenshen-action-library" } } }
```

**B. 调面板 RPC**（重启 Coo 后执行一次即可）：

```
POST http://127.0.0.1:17788/api/webui/providers/world:extra-actions/panels/picker/set-download-url
{"args":["https://gitee.com/<你的账号>/shenshen-action-library"]}
```

填完之后，面板首次打开时那个一次性提示里的「去下载」按钮就会指向它。

---

## 四、Gitee 的硬限制（务必确认没超）

| 项目 | Gitee 社区版限制 | 本库 |
|---|---|---|
| 单仓库大小 | **500 MB** | 370 MB（占 74%，还行） |
| 单文件大小 | **50 MB** | 最大 7.7 MB ✅ |
| 用户总仓库容量 | 5 GB | ✅ |
| 公开仓库 | 需实名认证 | 请确认 |

以后要加动作（>500 MB）就再开第二个仓库（例如 `shenshen-action-library-2`），
插件端会做成**地址列表**，天然支持多仓。

---

## 五、我已经写好的插件侧（0.3.18 分支 `feat/panel-ux`）

- **首启一次性提示**：完整库没下载时弹一次，点「知道了」写进 `config.json` 的
  `worlds.extra-actions.onboardSeen`，以后不再弹
- **下载地址配置项**：`worlds.extra-actions.downloadUrl`，对应 `invoke('set-download-url',[url])`，
  提示里的「去下载」按钮读它
- **默认只列库里有的动作**：工具栏开关「显示全部 N 段未下载的」，避免新用户看到 102 条灰的
- **缺段提示**：状态行点名列缺的段（最多 6 个）+ 底部汇总「另有 N 段未下载」

**还没做（等地址到位）**：真正的自动下载。两条实现路径：

1. **按文件增量下载**（推荐）：遍历 `actions/index.js` 里缺的 id，逐个 GET `anim.webp`（每段 3.5 MB），
   支持 Range 断点、进度轮询、失败重试 —— 这样用户可以只补缺的段
2. 整包下载 + 解压：需要引入 `fflate`（约 7 KB）解压 zip，一次性 370 MB

---

## 六、回填清单（做完请勾选并在括号里写结果）

- [ ] Gitee 仓库已建（地址：______________）
- [ ] 105 段已推送（`git ls-tree -r master --name-only | grep -c anim.webp` 应为 **105**）
- [ ] raw 直链验证（HTTP 状态：______，Content-Length：______，是否有重定向：______）
- [ ] 仓库地址已写进 `config.json` 或调过 `set-download-url`（写的是：______________）
- [ ] 是否发现 Gitee 有防盗链 / 限速 / 需要 token：______________

有任何一条走不通，把现象写在这里，我这边改插件侧适配。

—— 奶糖_Net（Net-ang）
