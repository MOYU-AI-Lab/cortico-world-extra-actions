# 深深与额外动作拓展（Coopanion 扩展）

`cortico-world-extra-actions` · MIT · 作者：Daniele贤狼赫萝 & 奶糖_Net（丹尼尔 / Net-ang）
发布流程见 [PUBLISH.md](PUBLISH.md)。

把《深深 · 动作库》里的 105 段动作做成一张勾选表：勾中的动作写进形象包的
`额外动作拓展/` 文件夹，桌宠照着做 —— 待机会轮播、点她会触发、重启后 bot 也能点名。

- 插件形态：Cortico World（`kind: world`, `api: 6`），面板在 Coopanion 的扩展页里；显示名 **深深与额外动作拓展**
- 数据落点：`<形象包>/额外动作拓展/`（桌宠读的东西）+ `worlds.extra-actions.libraryDir`（走 `WorldContext.persist` 存进 config.json）
- 不改播放器、不改形象包的其它文件；`figure.json` 只增删它自己管过的那几个词，第一次动之前留备份

## 零、协议与安全（先看这段）

这个包是 **Cortico World**，不是往主程序里塞代码。契约按安装目录里的源码
（`resources/app/build/cortico/src/`）核对过：

| 契约 | 要求 | 本包 |
|---|---|---|
| `package.json` → `cortico.kind` | `world` / `provider` / `bot` | `world` ✓ |
| `cortico.api` | 必须**正好**是 `EXTENSION_API_VERSIONS.world = 6` | `6` ✓ |
| `cortico.webUiClient` | 包内相对路径、不含 `\`、不以 `/` 开头、无 `..`、`.js/.mjs` | `dist/webui.js` ✓ |
| `keywords` | 要有 `cortico-world` | ✓ |
| 默认导出 | 有 `id` / `label` / `defaults()` / `create()` | ✓（`isWorldDefinition` 就查这四项） |
| 实例 | `start(host)` / `stop()` / `envPromptVars()` / `tools()` | ✓（`tools()` 返回空数组：不给 bot 任何可调用的写入口） |
| 面板 | `webUi(language)` 返回 `{ label, panels, invoke }`，客户端 `export default { panels: { picker } }` | ✓ |
| 配置 | `WorldContext.cfg` 是活引用，改动走 `ctx.persist(patch)` | 动作库路径就是这么存的 |
| 目录 | `WorldContext.botDir` 是部署目录，桌宠数据在它下面 `data/figures` | 优先用它定位，不再瞎猜 |

没有引入 `cortico/*` 任何模块，所以**不走宿主的 tsx 解析链**，纯 ESM 直接被 `import()` 加载；
整个包里没有 `eval` / `new Function` / 子进程 / 本地 HTTP 服务。

**注入面**（写入是唯一碰磁盘的地方，`src/writer.js` 全部收紧）：

- 只写 `<pack>/额外动作拓展/`，写之前校验路径确实在那个包里（`isInside`，挡 `..`、盘符、越界）；
- 拷帧**只认清单里那 frames 张 `f_NNNN.webp`**，符号链接、非常规文件、>4 MB 的帧、>64 MB 的模块一律拒绝；
  不做整目录递归拷贝 —— 动作库里多塞一个 `payload.js` 也不会进包；
- `action.json` 不复制，按校验过的字段重写；
- 生成的 `额外动作拓展/index.js` 是**数据**：所有字符串走 `JSON.stringify`，id/分类/路径先过
  `^[a-z0-9][a-z0-9-]{0,31}$` 白名单，名字去掉控制字符与行分隔符；
- `figure.json` 只动 `vocab` 一个字段；
- 面板侧对拿到的清单同样再筛一遍（id/分类/帧数/时长/缩略图前缀），不信任 invoker 传来的任何东西；
- `invoke` 的参数当不可信输入：包 id 必须匹配 slug 正则，一次最多 300 个动作。

---

## 一、装

### 一键

```bat
node tools/install-extension.mjs
```

它会：把本目录拷到 `D:\coopa\Coopanion\data\extensions\vendor\cortico-world-extra-actions\`，
在 `data\extensions\package.json` 里加一条 `link:` 依赖（先备份 `package.json.bak-extra-actions`），
再建一个 `node_modules` 联接。**然后重启 Coopanion**。

### 手动三步

1. 把整个文件夹拷到 `...\data\extensions\vendor\cortico-world-extra-actions\`
2. `data\extensions\package.json` 的 `dependencies` 里加一行：
   `"cortico-world-extra-actions": "link:vendor/cortico-world-extra-actions"`
3. 建联接（管理员不需要，junction 就行）：
   `mklink /J "...\data\extensions\node_modules\cortico-world-extra-actions" "...\data\extensions\vendor\cortico-world-extra-actions"`

重启后，Coopanion 的扩展页里会出现「额外动作拓展」。

## 二、用

面板里：

1. 上方选一个**可写**的形象包（只有会读 `额外动作拓展/` 的播放器才列出来 —— 目前是
   《深深 · 动作库》`shenshen-actions`，以及打了对应补丁的深深）。
2. 左下的分类芯片 + 搜索框筛动作；点一行就勾上/取消。
3. 右下「保存到形象包」。

保存时它做的事：

- 勾中的模块：从动作库把 `f_0001.webp…` + `preview.webp` + `action.json` 拷进
  `<包>/额外动作拓展/<分类>/<id>/`（已经拷过的不重复拷）
- 取消勾选的：删掉对应目录
- 重写 `额外动作拓展/index.js`（桌宠 import 的那份清单）、`index.json`、`README.md`
- **把 `figure.json` 的动作词裁成你勾的这些**：勾中的加进去，没勾的动作词撤掉（表情、非动作条目一个字不动）。
  第一次改之前备份 `figure.json.bak-额外动作拓展`，原始词表记在 `.managed.json` 里
- **不碰桌宠**：插件只读桌宠的 /api/state、/api/figures。要让新动作立刻生效，去 Coopanion 的**装扮页**重新点一下这个形象

所以语义是 **勾选即全部**：勾了什么，桌宠就只做这些 —— 待机轮播、点击回应、bot 能说的动作词，
都收在这次勾选里。没勾的动作不会自己冒出来。

**名词生效时机**：`figure.json` 是 Coopanion 启动时扫的，所以 bot 要**重启后**才会说
`【吃饺子】`；在那之前动作已经在待机轮播和点击里了。

命令行（不用面板也能干同样的事）：

```bat
node tools\extra-actions-cli.mjs list
node tools\extra-actions-cli.mjs state
node tools\extra-actions-cli.mjs save --pack shenshen-actions --ids eat-dumplings,fireworks,cheer-wave
node tools\extra-actions-cli.mjs clear --pack shenshen-actions
```

## 三、`额外动作拓展/` 长什么样

```
<形象包>/额外动作拓展/
├─ index.js       ← 桌宠读的就是这个
├─ index.json     同一份内容，给工具和人看
├─ README.md      这一份是谁写的、什么时候、勾了什么
├─ .managed.json  插件管过哪些动作、加过哪些词（取消勾选和恢复时用）
└─ eat/eat-dumplings/
   ├─ f_0001.webp … f_0241.webp   640×360，24 fps
   ├─ preview.webp
   └─ action.json
```

`index.js`：

```js
export default [
  { word: "eat-dumplings", clip: "额外动作拓展/eat/eat-dumplings", frames: 241, fps: 24,
    seconds: 10.042, name: "吃饺子", category: "eat", noMirror: false, reaction: false, random: true },
];
```

播放器把这一份并到 `actions/index.js` 后面（同名词以这份为准），`word` 不为空的登记进词表。
所以只要播放器认这个格式，**换一个形象包也能直接复用这个文件夹**。

## 四、限制与边界

- **只支持帧序列播放器**：入口 `figure.js` 里得出现 `额外动作拓展` 或 `actions/index.js`。
  《深深 · 动作库》和本仓库配套的那个播放器可以；早先只认 `ext/clips.js` 的补丁、以及 horo /
  clawd 这些别的角色都不行（面板里不会列出来）。
- **帧画的是深深**：这是整段画好的 640×360 立绘，不是分层部件。加进别的角色会穿帮，
  也没法叠在别人的立绘上 —— 面板会提示。
- **状态类动作不勾**：`state-idle / state-walk / state-drag / look-around` 是身体的待机、走路、
  被拎起和转向，勾了没用（它们本来就在包里）。
- **只写可写的包**：Coo / 鲸鱼这些内置包不会被列出来。
- **可逆**：`figure.json` 只动插件自己加过的词；一键「清空拓展」会删掉整个
  `额外动作拓展/` 并把词撤干净。改动前的原文在 `figure.json.bak-额外动作拓展`。

## 完整动作库

插件自带的是**入门套装**（4 段身体状态 + 3 段示例动作）。全部 **105 段**在单独的压缩包里：

- 下载：<https://github.com/DanieleWolfHOLO/cortico-world-extra-actions/releases/download/library/shenshen-action-library.zip>
- 解压得到 `深深-动作库/`（约 320 MB，26000 多个帧文件）
- 面板点「选择动作库…」指向这个文件夹 —— 列表里就会出现全部 105 段，可以随便勾

## 五、添加更多动作

面板最下面有一个折叠的 **「添加更多动作…」**：选一个文件夹，里面是一整套
`f_0001.webp`、`f_0002.webp`…（同尺寸），或者一个装着若干这种文件夹的父目录。
它会：

1. 把帧收进 `<动作库>/actions/<分类>/<id>/`（默认分类 `extra`，同名 id 自动加 `-2`）；
2. 按「帧数 ÷ fps」算时长，写一个 `action.json`；
3. 往 `actions/index.js` 追加一行 —— 桌宠的播放器就认它。

收进来之后，这些动作和自带的 105 段一样出现在上面的列表里，可以勾选、保存到形象包。
可选在同目录放 `action.json` 指定 `{"id":"eat-burger","zh":"吃汉堡","category":"extra","fps":24}`；
不给就按目录名生成、24 fps。

安全上和写入层同一套：只拷贝 `f_NNNN.webp`（源目录里别的东西不会进库）、拒绝符号链接、
单帧 ≤4 MB / 单模块 ≤128 MB、id 与分类过白名单、`index.js` 里所有字符串走 `JSON.stringify`。

命令行同样能加：`node tools\extra-actions-cli.mjs add --dir <文件夹>`。

## 六、制作

面板最下面还有一个折叠的 **「制作」**，放着两位制作人的头像与分工（头像以 data URL 嵌在面板里，
不读本地文件、不发网络请求，默认折叠，不影响日常勾选）：

- **Daniele贤狼赫萝（丹尼尔）** —— 形象包机制与插件制作 · `1143669795@qq.com`
- **奶糖_Net（Net-ang）** —— 制作 · 素材与实现 · `2967731401@qq.com`

形象包的 `figure.json` 里也记了这两条 `credits`。

## 七、文件

| 路径 | 作用 |
|---|---|
| `src/index.js` | World 定义（`id` / `label` / `defaults` / `create` / `describe`） |
| `src/world.js` | 面板方法、形象包发现、保存/清空、扫库清单、参数校验 |
| `src/writer.js` | 纯落盘逻辑 + 注入面防护（面板和命令行共用） |
| `src/importer.js` | 「添加更多动作」：校验一套帧、收进动作库、重建清单 |
| `src/starter.js` | 自带素材落地 + 「恢复空的形象包」 |
| `src/pet.js` | 本地桌宠服务的**只读**客户端（`/api/state`、`/api/figures`） |
| `dist/webui.js` | 面板（无 import 的纯 ESM，`export default { panels: { picker } }`） |
| `assets/catalog.json` | 105 段动作的清单 + 缩略图 |
| `assets/starter/` | 自带的形象包与示例动作库（首次启动落地） |
| `assets/icon.webp` | 扩展封面（`cortico.icon`） |
| `tools/install-extension.mjs` | 装到 Coopanion（拷包 + link 依赖 + junction），需要 `--extensions` |
| `tools/extra-actions-cli.mjs` | 命令行：list / state / save / remove / clear / add / prune / reindex |
| `tools/check-registered.mjs` | 自检：宿主能不能按 name 解析到这个包、config 里有没有它 |
| `tools/verify_installed.mjs` | 对真机：装好的包是不是只做勾选的那些 |
| `tools/test_writer.mjs` | 保存 / 删除 / 清空 / 瘦身的落盘语义 |
| `tools/test_security.mjs` | 注入面：路径、白名单、符号链接 |
| `tools/test_importer.mjs` | 「添加更多动作」 |
| `tools/test_catalog.mjs` | 清单以磁盘为准、index 可重建 |
| `tools/test_panel_guard.mjs` | 面板模板缺节点会当场报错 |
| `tools/test_starter.mjs` | 自带素材的首次落地 |
| `tools/test_restore.mjs` | 「恢复空的形象包」与查重 |
