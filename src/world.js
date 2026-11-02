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
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRA_DIR, clear, inspect, isInside, packLooksSupported, prunePack, readExtra, removeOne, save } from './writer.js';
import { addModules, rebuildIndex, scanLibrary } from './importer.js';
import { ensureStarter, restorePack } from './starter.js';
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
        libraryDir: () => this.libraryDir(),
        saveSettings: (patch) => this.saveSettings(patch),
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

    const bundleById = new Map(this.bundle.actions.map((a) => [a.id, a]));
    let actions;
    if (lib && existsSync(join(lib, 'actions'))) {
      actions = [...scanLibrary(lib).values()].map((m) => {
        const b = bundleById.get(m.id) ?? {};
        return {
          ...b,                                        // 缩略图、体积这类打包时才知道的
          ...m,                                        // 磁盘上的元数据覆盖它
          catZh: CATEGORY_ZH[m.category] ?? b.catZh ?? m.category,
          thumb: m.thumb ?? b.thumb ?? previewThumb(lib, m.clip),
          bytes: m.bytes ?? b.bytes ?? 0,
        };
      });
    } else {
      actions = [...bundleById.values()];
    }
    const data = { ...this.bundle, actions, count: actions.length, words: actions.filter((a) => a.word).length };
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
    for (const p of installed) {
      const packDir = join(dir, String(p.id));
      const supported = packLooksSupported(packDir);
      const extra = readExtra(packDir);
      out.push({
        id: p.id,
        name: typeof p.name === 'object' ? (p.name.zh || p.name.en || p.id) : String(p.name ?? p.id),
        current: p.id === current,
        builtin: p.removable === false,
        supported,
        dir: packDir,
        extra: { ids: extra.ids, count: extra.ids.length, bytes: extra.bytes, updatedAt: extra.updatedAt },
      });
    }
    // 没被 /api/figures 列出但磁盘上有的（桌宠没启动时）
    if (!out.length) {
      try {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (!e.isDirectory()) continue;
          const packDir = join(dir, e.name);
          const fig = readJson(join(packDir, 'figure.json'));
          if (!fig) continue;
          const extra = readExtra(packDir);
          out.push({
            id: String(fig.id ?? e.name),
            name: typeof fig.name === 'object' ? (fig.name.zh || e.name) : e.name,
            current: fig.id === current,
            builtin: false,
            supported: packLooksSupported(packDir),
            dir: packDir,
            extra: { ids: extra.ids, count: extra.ids.length, bytes: extra.bytes, updatedAt: extra.updatedAt },
          });
        }
      } catch { /* 目录都读不到就空着 */ }
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
        return this.restoreShenshenPack();
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
        count: merged.count,
        words: merged.words,
        imported: merged.actions.filter((a) => !this.bundleIds().has(a.id)).length,
        categories: [...new Set(merged.actions.map((a) => a.category))]
          .map((c) => ({ id: c, zh: CATEGORY_ZH[c] ?? c, count: merged.actions.filter((a) => a.category === c).length })),
      },
      folder: EXTRA_DIR,
      figuresDir: this.figuresDir(),
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
    const r = addModules({
      sourceDir,
      libraryDir: lib,
      existingIds: new Set(merged.actions.map((a) => a.id)),
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

  setLibrary(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('没有给出目录');
    const clean = normalize(value.trim());
    if (clean.length > 500) throw new Error('目录名太长');
    if (!isAbsolute(clean)) throw new Error(`要绝对路径：${clean}`);
    if (!existsSync(clean)) throw new Error(`目录不存在：${clean}`);
    if (!statSync(clean).isDirectory()) throw new Error(`不是目录：${clean}`);
    if (!existsSync(join(clean, 'actions'))) throw new Error(`这个目录不像动作库（缺 actions/）：${clean}`);
    this.saveSettings({ libraryDir: clean });
    this._figuresDir = null;
    return { ok: true, libraryDir: this.libraryDir() };
  }

  /** 一键（重新）得到一个空的深深形象包；同时只允许存在一个。 */
  async restoreShenshenPack() {
    const r = restorePack({
      pkgDir: join(HERE, '..'),
      figuresDir: () => this.figuresDir(),
      log: (msg) => this.host?.log?.info?.(msg),
    });
    this.bustCatalog();
    return r;
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

  /** 拿到的 packDir 必须真在 figures 目录下面，否则不写。 */
  assertPackInside(dir) {
    const root = this.figuresDir();
    if (!isInside(root, dir)) throw new Error(`形象包不在 figures 目录里：${dir}`);
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
    const result = save({
      packDir: pack.dir,
      ids,
      catalog: this.mergedCatalog().actions,
      libraryDir,
      pack: { id: pack.id, name: pack.name },
    });
    this.host?.log?.info?.(`额外动作拓展：${pack.id} 写入 ${result.count} 段`, {
      copied: result.copied.length, skipped: result.skipped.length, removed: result.removed.length,
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
