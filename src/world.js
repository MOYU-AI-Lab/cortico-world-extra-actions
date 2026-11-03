/**
 * 「额外动作拓展」这个 World：把动作库里的动作勾进某个形象包。
 *
 * 数据落点：
 *   <形象包>/额外动作拓展/          ← 桌宠读的东西（index.js + 帧 + README）
 *   worlds.extra-actions.libraryDir ← 动作库在哪，走 WorldContext.persist 存进 config.json
 *
 * 面板（dist/webui.js）只做界面，所有落盘都在 writer.js 里，所以"面板保存"和"命令行保存"结果一致。
 * 这个文件不直接碰文件内容，只做发现、校验和转发。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRA_DIR, clear, inspect, isInside, packLooksSupported, prunePack, readExtra, removeOne, save } from './writer.js';
import { addModules, rebuildIndex, scanLibrary } from './importer.js';
import { ensureStarter, installStarterLibrary, libraryHealth, restorePack, safePackName } from './starter.js';
import { petFigures, petState } from './pet.js';

const ID = 'extra-actions';
const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_FILE = join(HERE, '..', 'assets', 'catalog.json');
const PANEL = 'picker';
/** 保存之后要说的话：插件不碰桌宠，重载交给用户。 */
const RELOAD_HINT = '保存已生效。去 Coopanion 的装扮页重新点一下该形象，桌宠才会加载新的动作表。';
/** 模块目录里的 preview.webp 直接转 data URL 当缩略图（不重编码，够用）。 */
function previewThumb(lib, clip) {
  try {
    const file = join(lib, ...String(clip).split('/'), 'preview.webp');
    if (!existsSync(file)) return null;
    return 'data:image/webp;base64,' + readFileSync(file).toString('base64');
  } catch { return null; }
}

const CATEGORY_ZH = {
  core: '核心', event: '事件', eat: '吃喝', festival: '节日', work: '工作',
  perf: '才艺', play: '玩乐', daily: '日常', fx: '特效', mutter: '碎碎念', extra: '自定义',
};
/** 一次最多勾多少（writer 里也有同一道闸）。 */
const MAX_SELECTION = 300;

const readJson = (file, fallback = null) => {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
};

export class ExtraActionsWorld {
  /** @param {{ ctx: { dataDir: string, botDir?: string, cfg?: object, persist?: (patch: object) => void } }} o */
  constructor({ ctx }) {
    if (!ctx || typeof ctx.dataDir !== 'string' || !ctx.dataDir) throw new Error('缺少 WorldContext.dataDir');
    this.id = ID;
    this.ctx = ctx;
    this.dataDir = ctx.dataDir;
    this.botDir = typeof ctx.botDir === 'string' ? ctx.botDir : '';
    this.host = null;
    /** 打包时生成的内置清单：只在库没设置/读不到时兜底，另外提供缩略图。 */
    this.bundle = readJson(CATALOG_FILE, null);
    if (!this.bundle?.actions?.length) throw new Error('assets/catalog.json 缺失或损坏');
    this._cat = null;
    this._catalogBust = 0;
  }

  async start(host) {
    this.host = host;
    // 第一次启动：把插件自带的入门套装铺到磁盘（已有就什么都不做）
    try {
      const seeded = ensureStarter({
        pkgDir: join(HERE, '..'),
        figuresDir: () => this.figuresDir(),
        dataDir: this.dataDir,
        botDir: this.botDir,
        libraryDir: () => this.libraryDir(),
        saveSettings: (patch) => this.saveSettings(patch),
        // 没有形象包就完全没法用：至少铺一个空壳（4 段身体状态、词表空）。
        // 动作库仍然不碰 —— 放哪个盘由用户在面板里选。
        seedPack: true,
        log: (msg, extra) => host?.log?.info?.(msg, extra),
      });
      if (seeded.pack || seeded.library) this.bustCatalog();
    } catch (e) {
      host?.log?.warn?.('自带素材没能铺开（不影响已有配置）', { err: String(e) });
    }
    const c = this.mergedCatalog();
    const imported = c.actions.filter((a) => !this.bundleIds().has(a.id)).length;
    host?.log?.info?.(`额外动作拓展已就绪：${c.count} 个动作（自定义 ${imported}），库 ${this.libraryDir() || '未设置'}`);
  }

  async stop() { this.host = null; }

  bundleIds() { return new Set(this.bundle.actions.map((a) => a.id)); }

  /** 清单变了（导入/保存/瘦身）就让缓存失效。 */
  bustCatalog() { this._catalogBust++; this._cat = null; }

  /**
   * 面板看到的清单。**库在的时候以磁盘为真相**：每个模块目录里的 action.json 说了算，
   * 内置清单只补缩略图和体积。这样"索引/清单/磁盘三者不一致"这一类问题从结构上没有了。
   * 库没设置或读不到时退回内置清单，面板至少还能显示。
   */
  mergedCatalog() {
    const lib = this.libraryDir();
    const now = Date.now();
    const key = `${lib}|${this._catalogBust}`;
    if (this._cat && this._cat.key === key && now - this._cat.at < 4000) return this._cat.data;

    // 内置 105 条固定目录永远都在；库里有就用磁盘元数据覆盖，库里没有就标 present:false
    const disk = (lib && existsSync(join(lib, 'actions'))) ? scanLibrary(lib) : new Map();
    const actions = [];
    const seen = new Set();
    for (const b of this.bundle.actions) {
      const m = disk.get(b.id);
      seen.add(b.id);
      actions.push({
        ...b,
        ...(m ?? {}),                                  // 磁盘上的元数据优先
        catZh: CATEGORY_ZH[m?.category ?? b.category] ?? b.catZh ?? b.category,
        thumb: (m ? previewThumb(lib, m.clip) : null) ?? m?.thumb ?? b.thumb,
        bytes: m?.bytes ?? b.bytes ?? 0,
        dir: m?.clip ?? `actions/${b.category}/${b.id}`,   // 固定目录：库里没有也照给
        present: !!m,
      });
    }
    for (const [id, m] of disk) {
      if (seen.has(id)) continue;                      // 库里多出来的自定义模块，追加
      actions.push({
        ...m,
        catZh: CATEGORY_ZH[m.category] ?? m.catZh ?? m.category,
        thumb: m.thumb ?? previewThumb(lib, m.clip),
        bytes: m.bytes ?? 0,
        dir: m.clip,
        present: true,
        imported: true,
      });
    }
    const data = {
      ...this.bundle,
      actions,
      count: actions.length,
      present: actions.filter((a) => a.present).length,
      missing: actions.filter((a) => !a.present).length,
      words: actions.filter((a) => a.word).length,
    };
    this._cat = { key, at: now, data };
    return data;
  }

  envPromptVars() { return {}; }

  /* ---------- 设置 ---------- */

  /** 旧版把设置写在自己的 json 里；现在优先走 config.json 的 worlds.extra-actions，文件只做兼容兜底。 */
  get settingsFile() { return join(this.dataDir, 'extra-actions.json'); }

  settings() {
    const fromCfg = this.ctx.cfg && typeof this.ctx.cfg === 'object' ? this.ctx.cfg : {};
    const file = readJson(this.settingsFile, null) || {};
    const pick = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
    return {
      libraryDir: pick(fromCfg.libraryDir) || pick(file.libraryDir) || pick(this.bundle.library),
      figuresDir: pick(fromCfg.figuresDir) || pick(file.figuresDir),
    };
  }

  saveSettings(patch) {
    if (typeof this.ctx.persist === 'function') {
      this.ctx.persist(patch);
      return;
    }
    // 没有 persist 的宿主（命令行就是这样造的）：退回自己的 json
    const next = { ...this.settings(), ...patch };
    mkdirSync(this.dataDir, { recursive: true });
    writeFileSync(this.settingsFile, JSON.stringify(next, null, 2) + '\n', 'utf8');
  }

  libraryDir() { return this.settings().libraryDir; }

  /**
   * 形象包在哪：优先用 WorldContext.botDir（部署目录，桌宠的数据就在它下面 data\figures），
   * 再退到 dataDir 的几个常见位置，最后在附近有限深度找一次名为 figures 的目录。
   */
  figuresDir() {
    if (this._figuresDir) return this._figuresDir;
    const s = this.settings();
    const looksLikeFigures = (dir) => {
      try {
        if (!statSync(dir).isDirectory()) return false;
        return readdirSync(dir, { withFileTypes: true })
          .some((e) => e.isDirectory() && existsSync(join(dir, e.name, 'figure.json')));
      } catch { return false; }
    };
    const tries = [];
    if (s.figuresDir && isAbsolute(s.figuresDir)) tries.push(s.figuresDir);
    if (this.botDir) tries.push(join(this.botDir, 'data', 'figures'), join(this.botDir, 'figures'));
    tries.push(
      join(this.dataDir, 'figures'),
      join(this.dataDir, 'home', 'companion', 'data', 'figures'),
      join(this.dataDir, '..', 'figures'),
      join(this.dataDir, '..', 'data', 'figures'),
      join(this.dataDir, '..', 'home', 'companion', 'data', 'figures'),
      join(this.dataDir, '..', '..', 'data', 'figures'),
    );
    for (const dir of tries) if (looksLikeFigures(dir)) return (this._figuresDir = dir);

    // 有限深度找一次（宿主把 dataDir 指到别处时兜底）
    const seen = new Set();
    const walk = (dir, depth) => {
      if (depth < 0 || seen.has(dir)) return null;
      seen.add(dir);
      if (/[\\/]figures$/.test(dir) && looksLikeFigures(dir)) return dir;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue;
        if (/^figures$/.test(e.name) && looksLikeFigures(join(dir, e.name))) return join(dir, e.name);
        const hit = walk(join(dir, e.name), depth - 1);
        if (hit) return hit;
      }
      return null;
    };
    const found = walk(this.dataDir, 4);
    return (this._figuresDir = found ?? join(this.dataDir, 'figures'));
  }

  /**
   * Coo 注入的额外形象包根（Steam Workshop、自定义目录）：主进程把它放在
   * `COOPANION_PACK_ROOTS` 里传给 Core，桌宠那边的 packRoots 就是这么来的。
   * 这些根里的包桌宠同样看得见，所以这里也当合法落点/落库位置。
   */
  extraRoots() {
    const raw = typeof process !== 'undefined' ? (process.env.COOPANION_PACK_ROOTS ?? '') : '';
    return String(raw)
      .split(delimiter)
      .map((s) => s.trim())
      .filter((s) => s && isAbsolute(s) && existsSync(s));
  }

  /** 全部形象包根，第一个是主 figures 目录。 */
  figureRoots() {
    const primary = this.figuresDir();
    const out = [primary];
    for (const r of this.extraRoots()) {
      const hit = out.some((d) => resolve(d) === resolve(r));
      if (!hit) out.push(r);
    }
    return out;
  }

  /** id → 包目录：扫所有根，`figure.json` 的 id 优先，目录名兜底。 */
  packDirs() {
    const map = new Map();
    for (const root of this.figureRoots()) {
      let entries;
      try { entries = readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const dir = join(root, e.name);
        const fig = readJson(join(dir, 'figure.json'), null);
        if (!fig) continue;
        const id = String(fig.id ?? e.name);
        if (!map.has(id)) map.set(id, { dir, root, fig });
      }
    }
    return map;
  }

  /* ---------- 列表 ---------- */

  /** 能往里写动作的形象包：装了、在 figures 目录里、入口看着像帧序列播放器。 */
  async figures() {
    const dir = this.figuresDir();
    let installed = [];
    try {
      installed = await petFigures();
    } catch {
      installed = [];
    }
    let current = null;
    try { current = (await petState())?.skin?.figure ?? null; } catch { /* 桌宠没开 */ }

    const out = [];
    const dirs = this.packDirs();
    for (const p of installed) {
      const hit = dirs.get(String(p.id));
      const packDir = hit?.dir ?? join(dir, String(p.id));
      const supported = packLooksSupported(packDir);
      const extra = readExtra(packDir);
      out.push({
        id: p.id,
        name: typeof p.name === 'object' ? (p.name.zh || p.name.en || p.id) : String(p.name ?? p.id),
        current: p.id === current,
        builtin: p.removable === false,
        supported,
        dir: packDir,
        root: hit?.root ?? dir,
        extra: { ids: extra.ids, count: extra.ids.length, bytes: extra.bytes, updatedAt: extra.updatedAt },
      });
    }
    // 没被 /api/figures 列出但磁盘上有的（桌宠没启动时）：把所有根都扫一遍
    if (!out.length) {
      for (const [id, hit] of dirs) {
        const extra = readExtra(hit.dir);
        out.push({
          id,
          name: typeof hit.fig.name === 'object' ? (hit.fig.name.zh || id) : String(hit.fig.name ?? id),
          current: id === current,
          builtin: false,
          supported: packLooksSupported(hit.dir),
          dir: hit.dir,
          root: hit.root,
          extra: { ids: extra.ids, count: extra.ids.length, bytes: extra.bytes, updatedAt: extra.updatedAt },
        });
      }
    }
    out.sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name, 'zh'));
    return out;
  }

  /* ---------- World 契约 ---------- */

  tools() { return []; }

  webUi(language = 'zh') {
    return {
      label: language === 'en' ? 'Shenshen & Extra Actions' : '深深与额外动作拓展',
      panels: [{
        id: PANEL,
        title: language === 'en' ? 'Shenshen & Extra Actions' : '深深与额外动作拓展',
        description: language === 'en'
          ? 'Tick the motions Shenshen may do; they are written into the pack\'s 额外动作拓展 folder.'
          : '勾选想让深深做的动作，写进形象包的「额外动作拓展」文件夹，桌宠照着做。',
      }],
      invoke: (panel, method, args) => this.invoke(panel, method, args),
    };
  }

  async invoke(panel, method, args = []) {
    if (panel !== PANEL) throw new Error(`unknown panel: ${panel}`);
    const a = Array.isArray(args) ? args : [];
    switch (method) {
      case 'catalog':
        return this.mergedCatalog();
      case 'state':
        return this.state();
      case 'add':
        return this.addActions(typeof a[0] === 'string' ? a[0] : '');
      case 'prune':
        return this.prune(this.cleanPackId(a[0]));
      case 'reindex':
        return this.reindex();
      case 'restore-pack':
        // args: [落点目录(可选), 包名(可选)]
        return this.restoreShenshenPack(typeof a[0] === 'string' ? a[0] : '', typeof a[1] === 'string' ? a[1] : '');
      case 'find-libraries':
        return this.findLibraries();
      case 'dirs':
        return this.fixedDirs();
      case 'use-starter-library':
        return this.useStarterLibrary(a[0]);
      case 'save': {
        const packId = this.cleanPackId(a[0]);
        const ids = Array.isArray(a[1]) ? a[1].slice(0, MAX_SELECTION).map((v) => String(v).slice(0, 40)) : [];
        return this.saveAction(packId, ids);
      }
      case 'clear':
        return this.clearAction(this.cleanPackId(a[0]));
      case 'remove':
        return this.removeAction(this.cleanPackId(a[0]), String(a[1] ?? '').trim());
      case 'set-library':
        return this.setLibrary(a[0]);
      default:
        throw new Error(`unknown method: ${method}`);
    }
  }

  /** 形象包 id 只可能是那串 ascii slug；别的一律当没给。 */
  cleanPackId(value) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) throw new Error('形象包 id 不合法');
    return id;
  }

  async state() {
    const merged = this.mergedCatalog();
    const s = this.settings();
    const libraryDir = s.libraryDir;
    const libOk = !!libraryDir && existsSync(libraryDir);
    const figs = await this.figures();
    const pick = figs.find((f) => f.supported && !f.builtin) ?? figs.find((f) => f.supported) ?? null;
    return {
      figures: figs,
      current: figs.find((f) => f.current)?.id ?? null,
      pick: pick?.id ?? null,
      library: {
        dir: libraryDir,
        ok: libOk,
        // count 是"目录里一共 105 条"，present 是"这一段库里真的有帧"
        count: merged.count,
        present: merged.present,
        missing: merged.missing,
        words: merged.words,
        imported: merged.actions.filter((a) => !this.bundleIds().has(a.id)).length,
        categories: [...new Set(merged.actions.map((a) => a.category))]
          .map((c) => ({ id: c, zh: CATEGORY_ZH[c] ?? c, count: merged.actions.filter((a) => a.category === c).length })),
      },
      folder: EXTRA_DIR,
      figuresDir: this.figuresDir(),
      roots: this.figureRoots(),
      installed:
        pick && pick.supported
          ? inspect({ packDir: pick.dir, libraryDir: libOk ? libraryDir : '', catalog: merged.actions })
          : null,
    };
  }

  /** 把一套自己的帧收进动作库（库目录 + actions/index.js），之后就能在面板里勾。 */
  async addActions(sourceDir) {
    const lib = this.libraryDir();
    if (!lib || !existsSync(lib)) throw new Error('动作库目录没设置好（右边「选择动作库」）');
    const merged = this.mergedCatalog();
    // 目录固定：清单里有的 id 一律落到它登记的分类目录，避免同一个动作出现两个路径
    const fixedCat = new Map(merged.actions.map((a) => [a.id, a.category]));
    const r = addModules({
      sourceDir,
      libraryDir: lib,
      existingIds: new Set(merged.actions.map((a) => a.id)),
      fixedCategory: (id) => fixedCat.get(id) ?? null,
      thumbFor: (files, dir) => {
        try {
          const mid = files[Math.floor(files.length / 2)] ?? files[0];
          return `data:image/webp;base64,${readFileSync(join(dir, mid)).toString('base64')}`;
        } catch { return null; }
      },
    });
    if (r.added.length) {
      rebuildIndex(lib);          // 清单由 action.json 重新生成，不靠追加
      this.bustCatalog();
      this.host?.log?.info?.(`额外动作拓展：从 ${sourceDir} 收了 ${r.added.length} 个动作`, { ids: r.added.map((a) => a.id) });
    }
    return { ok: true, ...r, total: this.mergedCatalog().count };
  }

  /**
   * 选中的目录不一定是动作库本身 —— 用户经常选到"装着动作库的那层文件夹"。
   * 往下找一层：只有一个候选就用它，多个就让用户自己挑。
   */
  resolveLibraryDir(dir) {
    if (existsSync(join(dir, 'actions'))) return { dir, moved: false };
    const subs = [];
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        if (existsSync(join(dir, e.name, 'actions'))) subs.push(join(dir, e.name));
      }
    } catch { /* 读不动就当没有 */ }
    if (subs.length === 1) return { dir: subs[0], moved: true };
    if (subs.length > 1) {
      throw new Error(`这个文件夹下面有 ${subs.length} 个像动作库的目录，请选具体一个：${subs.map((p) => basename(p)).join('、')}`);
    }
    throw new Error(`这个目录里没有 actions/（不像动作库）：${dir}`);
  }

  setLibrary(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('没有给出目录');
    const clean = normalize(value.trim());
    if (clean.length > 500) throw new Error('目录名太长');
    if (!isAbsolute(clean)) throw new Error(`要绝对路径：${clean}`);
    if (!existsSync(clean)) throw new Error(`目录不存在：${clean}`);
    if (!statSync(clean).isDirectory()) throw new Error(`不是目录：${clean}`);
    const r = this.resolveLibraryDir(clean);
    this.saveSettings({ libraryDir: r.dir });
    this._figuresDir = null;
    this.bustCatalog();
    return {
      ok: true,
      libraryDir: r.dir,
      moved: r.moved,
      note: r.moved ? `你选的是上一级，已自动定位到里面的「${basename(r.dir)}」` : '',
    };
  }

  /**
   * 一键（重新）得到一个空的深深形象包。
   *
   * - 不给 `target`：老语义（有就修、没有才建、绝不重复造）。
   * - 给了 `target`：就在你选的位置建（选中的是某个根 → 在它下面按 `name` 建；选中的已是包 → 就地修）。
   *   落点必须落在 Coo 认识的某个形象包根里，否则桌宠看不到，这里直接拒绝并列出可用根。
   */
  async restoreShenshenPack(target = '', name = '') {
    const roots = this.figureRoots();
    const r = restorePack({
      pkgDir: join(HERE, '..'),
      roots: () => roots,
      target,
      name: safePackName(name || 'shenshen-actions'),
      log: (msg) => this.host?.log?.info?.(msg),
    });
    this.bustCatalog();
    return { ...r, roots };
  }

  /** 在用户选的目录下用自带示例建一个动作库并设为当前库（沿用作者 0.3.9 的做法）。 */
  async useStarterLibrary(parentDir) {
    const lib = typeof parentDir === 'string' ? parentDir.trim() : '';
    if (!lib) throw new Error('没有选择目录');
    const r = installStarterLibrary({ pkgDir: join(HERE, '..'), parentDir: lib, log: (m) => this.host?.log?.info?.(m) });
    this.saveSettings({ libraryDir: r.path });
    this.bustCatalog();
    this.host?.log?.info?.(`额外动作拓展：自带示例库已就绪 → ${r.path}`);
    return { ok: true, ...r, libraryDir: r.path };
  }

  /**
   * 「自动寻找动作库」：把机器上像动作库的地方扫一遍，列出来让人点，不用自己摸路径。
   *
   * 候选来源（都不写死路径，全部从环境里推）：
   *   1. 当前设置的库、`<dataDir>/shenshen-library`（自带那份）
   *   2. 每个形象包根本身、以及根下面每个带 `actions/` 的包
   *   3. 用户目录里的常见位置（桌面 / 文档 / 下载）中名字像「动作库 / actions / shenshen」的目录，
   *      以及名字不像但恰好含 `actions/` 的目录
   *   4. `SHENSHEN_LIBRARY` 环境变量指的那个
   * 每个候选只用 `scanLibrary` 数模块，扫不到模块的不算候选。
   */
  findLibraries() {
    const seen = new Map();
    const add = (dir, source) => {
      if (typeof dir !== 'string' || !dir.trim()) return;
      const abs = resolve(dir.trim());
      if (seen.has(abs)) return;
      const health = libraryHealth(abs);
      if (!health || health.count === 0) return;
      seen.set(abs, {
        dir: abs,
        count: health.count,
        categories: health.categories,
        source,
        current: false,
      });
    };

    const settings = this.settings();
    add(settings.libraryDir, '当前设置');
    add(process.env.SHENSHEN_LIBRARY ?? '', 'SHENSHEN_LIBRARY');
    add(join(this.dataDir, 'shenshen-library'), '插件自带');
    add(join(HERE, '..', 'assets', 'starter', 'library'), '插件内置示例');

    for (const root of this.figureRoots()) {
      add(root, '形象包根');
      let entries;
      try { entries = readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        add(join(root, e.name), '形象包里的动作');
      }
    }

    /* 用户目录里常见位置：只翻一层、只看名字像的，别把整块盘扫了 */
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const nameLike = /动作库|动作|actions|shenshen|library|库/i;
    for (const base of ['Desktop', 'OneDrive/Desktop', 'Documents', 'Downloads'].map((d) => join(home, d))) {
      let entries;
      try { entries = readdirSync(base, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
        const dir = join(base, e.name);
        // 名字像 → 直接当候选；名字不像但里面就有 actions/ → 也算
        if (nameLike.test(e.name) || existsSync(join(dir, 'actions'))) add(dir, '常见位置');
      }
    }

    const libraries = [...seen.values()]
      .map((l) => ({ ...l, current: !!settings.libraryDir && resolve(settings.libraryDir) === l.dir }))
      .sort((a, b) => Number(b.current) - Number(a.current) || b.count - a.count);
    return { ok: true, libraries, count: libraries.length, dataDir: this.dataDir, roots: this.figureRoots() };
  }

  /**
   * 全套动作的**固定目录**：以 `assets/catalog.json` 为准，每条给出
   * `actions/<分类>/<id>` 这个固定位置，以及当前库里有没有。
   *
   * 用途：目录名不再随用户放哪而变 —— 想补某个动作，只要让那个动作出现在
   * `actions/<分类>/<id>/` 里（下载单段、或用「添加更多动作…」收进来，两者都落到这里）。
   */
  fixedDirs() {
    const lib = this.libraryDir();
    const libOk = !!lib && existsSync(join(lib, 'actions'));
    const onDisk = libOk ? scanLibrary(lib) : new Map();
    const dirs = this.bundle.actions.map((a) => {
      const clip = `actions/${a.category}/${a.id}`;
      const have = onDisk.has(a.id);
      return {
        id: a.id,
        zh: a.zh,
        category: a.category,
        catZh: CATEGORY_ZH[a.category] ?? a.category,
        word: a.word ?? null,
        frames: a.frames,
        seconds: a.seconds,
        dir: clip,
        abs: libOk ? join(lib, ...clip.split('/')) : '',
        present: have,
      };
    });
    return {
      ok: true,
      library: { dir: lib, ok: libOk },
      count: dirs.length,
      present: dirs.filter((d) => d.present).length,
      dirs,
    };
  }

  /** 由 action.json 重生成 actions/index.js —— 清单和磁盘对不上时的万能修复。 */
  async reindex() {
    const lib = this.libraryDir();
    if (!lib || !existsSync(lib)) throw new Error('动作库目录没设置好');
    const r = rebuildIndex(lib);
    this.bustCatalog();
    this.host?.log?.info?.(`额外动作拓展：重建了 actions/index.js（${r.count} 条${r.changed ? '，有改动' : '，无变化'}）`);
    return { ok: true, ...r, libraryDir: lib };
  }

  /** 包瘦身：删掉包里用不到的动作模块，只留状态 + 勾选的。 */
  async prune(packId) {
    const figs = await this.figures();
    const pack = figs.find((f) => f.id === packId);
    if (!pack) throw new Error(`没有这个形象包：${packId}`);
    if (pack.builtin) throw new Error('内置形象包不给动');
    this.assertPackInside(pack.dir);
    const r = prunePack(pack.dir);
    this.bustCatalog();
    this.host?.log?.info?.(`额外动作拓展：${pack.id} 瘦身，删掉 ${r.removed.length} 个模块`, { freedMB: Math.round(r.freed / 1048576) });
    return { ok: true, pack: pack.id, ...r, hint: RELOAD_HINT };
  }

  /** 拿到的 packDir 必须真在某个形象包根下面，否则不写。 */
  assertPackInside(dir) {
    const roots = this.figureRoots();
    if (!roots.some((root) => isInside(root, dir))) {
      throw new Error(`形象包不在任何形象包目录里：${dir}（可用：${roots.join('；')}）`);
    }
    return dir;
  }

  async saveAction(packId, ids) {
    if (!packId) throw new Error('先选一个形象包');
    const figs = await this.figures();
    const pack = figs.find((f) => f.id === packId);
    if (!pack) throw new Error(`没有这个形象包：${packId}`);
    if (pack.builtin) throw new Error('内置形象包不给写');
    if (!pack.supported) throw new Error(`「${pack.name}」的 figure.js 不是帧序列播放器，装不了额外动作`);
    this.assertPackInside(pack.dir);
    const libraryDir = this.libraryDir();
    if (!libraryDir || !existsSync(libraryDir)) throw new Error('动作库目录没设置好（右边「选择动作库」）');

    this.bustCatalog();
    const merged = this.mergedCatalog();
    // 库里没补齐的（present=false）不能写：帧不在，拷进去必然是坏的。
    // 挑出来单独报告，而不是丢一个"库里缺 f_0001.webp"的笼统错误。
    const byId = new Map(merged.actions.map((a) => [a.id, a]));
    const wanted = [];
    const absent = [];
    for (const id of ids) {
      const a = byId.get(String(id));
      if (!a) continue;
      if (a.present === false) { absent.push(a.id); continue; }
      wanted.push(a.id);
    }
    if (!wanted.length) {
      throw new Error(absent.length
        ? `勾的 ${absent.length} 段动作库里还没有（缺帧）：${absent.slice(0, 8).join('、')}${absent.length > 8 ? '…' : ''} —— 先把它们放进动作库再保存`
        : '没有勾选任何可写进包的动作');
    }
    const result = save({
      packDir: pack.dir,
      ids: wanted,
      catalog: merged.actions,
      libraryDir,
      pack: { id: pack.id, name: pack.name },
    });
    if (absent.length) result.skippedMissing = absent;
    this.host?.log?.info?.(`额外动作拓展：${pack.id} 写入 ${result.count} 段`, {
      copied: result.copied.length, skipped: result.skipped.length, removed: result.removed.length,
      missing: absent.length,
    });

    return { ok: true, pack: pack.id, ...result, hint: RELOAD_HINT };
  }

  /** 删掉单个动作拓展：其余保持勾选，词表同步。 */
  async removeAction(packId, id) {
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) throw new Error('动作 id 不合法');
    const figs = await this.figures();
    const pack = figs.find((f) => f.id === packId);
    if (!pack) throw new Error(`没有这个形象包：${packId}`);
    if (pack.builtin) throw new Error('内置形象包不给动');
    this.assertPackInside(pack.dir);
    const libraryDir = this.libraryDir();
    this.bustCatalog();
    const r = removeOne({ packDir: pack.dir, id, catalog: this.mergedCatalog().actions, libraryDir, pack: { id: pack.id, name: pack.name } });
    this.host?.log?.info?.(`额外动作拓展：从 ${pack.id} 删掉 ${id}`, { remaining: r.remaining, cleared: r.cleared });
    return { ok: true, pack: pack.id, ...r, hint: RELOAD_HINT };
  }

  async clearAction(packId) {
    if (!packId) throw new Error('先选一个形象包');
    const figs = await this.figures();
    const pack = figs.find((f) => f.id === packId);
    if (!pack) throw new Error(`没有这个形象包：${packId}`);
    if (pack.builtin) throw new Error('内置形象包不给动');
    this.assertPackInside(pack.dir);
    this.bustCatalog();
    const r = clear(pack.dir, this.mergedCatalog().actions, pack.id);
    return { ok: true, pack: pack.id, ...r, hint: RELOAD_HINT };
  }
}
