# 0.3.35 补丁说明

> 基线：`扩展插件\_work\cwea-034`（0.3.34，已发布前的最后一版）
> 0.3.34 原样备份：`backups\cwea-0.3.34-20261115-222154`
> 工作副本：`扩展插件\_work\cwea-035`
> 状态：**已改完、已测（24/24 全绿）、未发布、未装到本机**

本版把 `待办-0.3.35.md` 里的 A/B/C/D 四块做掉了，等于把 issue #6 的四条候选补丁吸收进来，
再补上它们没覆盖的两处（写路径撞名、`ensureVocabNames` 账本）。

---

## A. 面板：「创建 / 修复深深形象包」按状态换文案

**问题**：新装的人第一眼看到「修复深深形象包」，像是已经坏了。原因两条叠加：
`syncRestoreBtn()` 只有「有包/没包」两态，而插件首次启动会自己铺一个**空壳**（`ensureStarter({seedPack:true})`），
所以「没包」那一支基本走不到。更别扭的是点「修复」照样弹目录选择器、确认框写着「建立一个空的角色包？」。

**改法**（`dist/webui.js`）：
- 新增 `restoreAction()`，三态判定全用现有字段（`state.figures[].extra.count` / `problem` / `dir`）：
  - 没有深深包，或只有空壳（`count === 0` 且清单没毛病）→ **创建深深形象包**
  - 写过动作，或 `problem` 非空 → **修复深深形象包**
- 「修复」**不再弹目录选择器**，直接对 `have.dir` 动手；确认框写清"只补缺文件、修清单，不动素材和已勾选动作"。
- note 里的按钮和指引改成共用 `restoreAction().label`（原来写死「修复深深形象包」/「建立空的角色包」）。
- 按钮的初始 HTML 文案同步改成「创建深深形象包」，首帧不会闪一下"修复"。

**「修复」到底修什么**（也写进 README 了）：`figure.json` 必备字段、`presets[].pick` / `console` 缺色、
vocab 名字禁字符与超长、缺的 `figure.js` / `figure.json` / 4 段身体状态。
**不修**：额外动作模块、动作库、`.managed.json` 勾选、被裁掉的动作词、素材、配色（除缺色）。

---

## B. issue #6 四条候选

| 候选 | 结论 | 落点 |
|---|---|---|
| ① 单动作下载先暂存再替换 | 采纳 | `src/online.js` `installAction()`：同父目录 `.id-incoming-` 暂存 → 校验 ZIP / JSON / id 与分类 / 有动画文件 → rename 换入，失败回滚；`finally` 清暂存目录（点目录不会被库扫描当成动作） |
| ② 预览缓存键加路径与文件状态 | 采纳 | `src/world.js` `preview()`：`JSON.stringify([resolve(file), size, mtimeMs, ctimeMs])` |
| ③ 用户词条合并保留 | 采纳，并修了它和我们的冲突 | 见 C |
| ④ 诊断只导可信包 / 修 `#` 路径 | 采纳（降级规则按我们的口径） | `tools/doctor.mjs` 用 `pathToFileURL()`；vocab 检查只对 `kind === 'motion'`，表情不再误报 |

④ 的口径和候选补丁不同：他们把所有「vocab 有、包里没有模块」都降成 notes（doctor 退出码永远 0）；
我们只在**包里 `actions/` 确实自带这段**时降成说明，其它仍算 ❌ —— 保住退出码能当验收用。

顺带修掉一个真崩溃：`tools/test_online.mjs`、`tools/test_download.mjs` 末尾 `server.close()` 没 await 就
`process.exit()`，Node 24 + Windows 上踩 libuv 断言 `!(handle->flags & UV_HANDLE_CLOSING)`，
**所有检查都过了却报 exit -1073740791**。改成 `await close` + `process.exitCode`。

---

## C. 词条账本：和 `ensureVocabNames` 的冲突（候选补丁没注意到）

候选补丁靠 `.managed.json` 新增的 `writtenVocab` 深度比对判断"用户改过没有"。但 0.3.34 的
`ensureVocabNames()`（`src/starter.js`，插件启动时跑）会**自己改写 names 却不更新账本**，
于是它修过的扩展词会被误判成用户编辑 → 清空动作后留下指向已删动作的悬空词。

本版改了两处：
1. `ensureVocabNames()` 写盘后调 `syncManagedVocab()`，把 `written` / `writtenVocab` 同步进账本；
2. **撞名策略统一**成 `uniqueName()`（`writer.js` 导出，双方共用）：撞了就加 2、3…，而不是原来
   `ensureVocabNames` 的"退回 id"。顺带修了它的一个隐藏 bug：名字恰好等于**自己的 id** 时，
   "退回 id"其实还是重名（宿主里 id 与别名共用一个命名空间），等于没修。

`writer.js` 侧同时：
- `applyVocab()` 接收 `catalog`、用 `reconcileBaseVocab()` 合并用户改动、写新词前用 `reserved` 集合避开重名；
- `restoreVocab()` 同样走 reconcile；
- 「有没有变化」从"比 id 序列"改成整份深度比对（`sameValue`），用户改 `names`/`about`/`seconds` 不再被旧快照覆盖；
- `save()` 在任何写盘之前做**别名冲突预检**（动作 id 已被别的词条当别名 → 直接报错，figure.json 一个字不动）。

---

## D. 写路径的撞名（候选补丁之外补的）

宿主 `packs.ts → readVocab()`：`badWordId` / `badWordName`（NAME_BREAK、>32 字）/ `nameTaken`（id + 全部别名全局唯一）/
缺 `about` / `badSeconds`，**任一条命中就整份 vocab 作废** → bot 一个动作都点不出来。

已有的：`safeWordName()`（剥禁字符、截 32、空回退 id）、`vocabEntry()`、`actionProblem()`（含 id 正则 `/^[a-z0-9][a-z0-9-]{0,31}$/`，`save()` 里逐条校验 —— 这一条本来就有，不用补）。
本版补的是 `applyVocab()` 写新词时的**去重**：以前直接 `kept.push(vocabEntry(a))`，两段 `zh` 一样的动作会写出两条同名，
宿主命中 `nameTaken` 拒掉整份词表 —— 实测现象正好是 issue #6 说的「点击会动、聊天指令不动」。

**为什么这块跟 0.3.34 有关**：`petReload()` 保存后立刻重载，等于把"写坏词表"的后果从"下次重启才出现"
变成"当场出现"；而 `ensureVocabNames()` 只在插件 `start()` 跑一次。所以 0.3.34 是**放大**了这个窗口而不是消除。

---

## 新测试

| 文件 | 内容 |
|---|---|
| `tools/test_035_patches.mjs` | 10 条：①坏 ZIP 保住旧模块、②两库同 id 同大小不串图、③/③b/③c 用户词条三段、④`#` 路径 + 表情不误报（**进程内跑 doctor**，不 spawn）、⑤/⑤b 撞名自动避开、⑥别名冲突零写入、⑦`ensureVocabNames` 修名字并同步账本 |
| `tools/test_panel_restore_label.mjs` | 15 条：`restoreAction()` 六种 state 的三态判定（从 `dist/webui.js` 抠原文直接跑）、修复分支不弹 `pickPath`、文案不再残留「建立空的角色包」 |

另外 `tools/test_freshuser.mjs` 改成**任何机器都能跑**：以前硬编码 `D:/Coopanion-data/深深-动作库-HD`，
换台机器就 ENOENT（0.3.34 上也是红的，看起来像回归）。现在按 `EXTRA_ACTIONS_HD_LIBRARY` → 作者机器路径 →
自带示例库 → 现造最小模块 的顺序兜底。

## 测试结果

```
23 个 test_*.mjs 全绿（含新加的两个）
node --check：src/*.js、dist/webui.js、tools/doctor.mjs 全部 OK
```

## 还没做（留到 0.3.36 或按需）

| 项 | 说明 |
|---|---|
| 整库下载的原子性 | 这次只做了**单段** `installAction`；`downloadLibrary` 仍是先解后换 |
| 空壳状态下要不要干脆不显示这个按钮 | 现在显示「创建深深形象包」，点了会问位置；如果觉得多余，可以改成首装隐藏 |
| `doctor` 退出码口径 | 现在"vocab 有、包里没有、但形象自带这段"算说明，其余算错；如果希望更宽松/更严可以再调 |
| 默认勾上点击回应 / 待机清晰度 / 缺身体状态警告 | 见 `cwea-034/PATCH-0.3.34.md` 末尾那张表，没动 |
