/**
 * 自带素材的落地：插件里打包了一份「入门套装」，第一次启动时铺到磁盘上。
 *
 * - 形象包 → **不自动铺**：位置交给用户在面板里选，然后建一个空壳（4 段身体状态 + 空词表）。
 *   只有显式传 `seedPack: true`（命令行/自测）才会静默铺到主 figures 目录。
 * - 小动作库 → **不自动铺**：用户点「用自带示例建库…」选个目录，才由
 *   `installStarterLibrary` 在 `<该目录>/深深-动作库` 建。启动时不替用户决定放哪、也不改 libraryDir。
 *
 * 所以装完插件启动是「什么都不写」的：面板会列出 105 条固定目录，库里还没有的标「库里没有」，
 * 并给出建库/选库的入口。105 段全量动作库则用「选择动作库位置…」指过去。
 *
 * 0.3.4 起，「恢复空的形象包」可以指定落点（`roots` / `target`）：Coo 除了主 figures 目录，
 * 还可能通过 COOPANION_PACK_ROOTS 挂别的根（Steam、自定义），那些根里的包桌宠同样能看到，
 * 所以也是合法的落点。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { EXTRA_DIR, MANAGED_FILE, uniqueName } from './writer.js';

const PACK_ID = 'shenshen-actions';
/** 包名（也是目录名、figure.json 的 id）：和 writer.js 的 id 白名单同一套。 */
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** 内置素材的根目录：<包>/assets/starter */
const starterRoot = (pkgDir) => join(pkgDir, 'assets', 'starter');

const readJson = (file, fallback = null) => {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
};

/** 包名归一化：不合法就退回默认 id，避免把奇怪的东西写进 figure.json。 */
export function safePackName(name) {
  const s = String(name ?? '').trim().toLowerCase();
  return SAFE_ID.test(s) ? s : PACK_ID;
}

/** 这个包里该有的东西齐不齐（`id` 是这个包应有的 id）。 */
/**
 * 宿主能不能加载这份 figure.json。返回 null = 没问题，否则一句人话。
 *
 * 为什么插件自己也要判：宿主是「一条不合格 → 整个包不加载」，界面上就是
 * "形象列表里没有它"；这时候用户点「修复」必须真的能修好，而不是被判为健康。
 * 只查最容易写错、且我们能自动修的那几条（其余交给 tools/manifest-check.mjs）。
 */
/** 导出版：世界层要给每个形象包标「宿主会不会加载它」。 */
export function manifestProblem(fig) {
  if (!fig || typeof fig !== 'object') return 'figure.json 读不出来';
  if (![1, 2].includes(fig.manifest)) return 'manifest 不是 1/2';
  if (![1, 2].includes(fig.api)) return 'api 不是 1/2';
  if (typeof fig.id !== 'string' || !SAFE_ID.test(fig.id)) return 'id 不合法';
  if (!fig.name || typeof fig.name !== 'object') return '缺 name';
  if (typeof fig.entry !== 'string' || !fig.entry) return '缺 entry';
  if (typeof fig.export !== 'string' || !fig.export) return '缺 export';
  for (const p of Array.isArray(fig.presets) ? fig.presets : []) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string') return 'preset 缺 id';
    if (!p.pick || typeof p.pick !== 'object') return `preset "${p.id}" 缺 pick`;
  }
  const BREAK = /[,，、\s【】<>＜＞]/;
  const taken = new Set();
  for (const w of Array.isArray(fig.vocab) ? fig.vocab : []) {
    const id = String(w?.id ?? '');
    if (!SAFE_ID.test(id)) return `vocab id 不合法: ${id}`;
    for (const list of Object.values(w?.names ?? {})) {
      for (const name of Array.isArray(list) ? list : []) {
        if (typeof name !== 'string' || !name.trim() || name.length > 32 || BREAK.test(name)) return `vocab 名字不合法: ${id}`;
      }
    }
    for (const name of [id, ...Object.values(w?.names ?? {}).flat()]) {
      if (taken.has(name)) return `vocab 名字重复: ${name}`;
      taken.add(name);
    }
  }
  return null;
}

/** 宿主要求的必备字段；缺了就补默认值（否则整包不加载）。 */
function ensureBasics(fig, id) {
  let changed = 0;
  const set = (k, v) => { if (fig[k] === undefined || fig[k] === null || fig[k] === '') { fig[k] = v; changed++; } };
  set('manifest', 2);
  set('api', 2);
  set('version', '1.0.0');
  set('entry', 'figure.js');
  set('export', 'createActionBody');
  if (!fig.name || typeof fig.name !== 'object') { fig.name = { zh: '深深 · 动作库', en: 'Shenshen · Action library' }; changed++; }
  if (!fig.about || typeof fig.about !== 'object') { fig.about = { zh: '深深的动作库形象包' }; changed++; }
  if (!Array.isArray(fig.axes)) { fig.axes = []; changed++; }
  if (!Array.isArray(fig.presets)) { fig.presets = []; changed++; }
  if (!Array.isArray(fig.vocab)) { fig.vocab = []; changed++; }
  if (fig.id !== id) { fig.id = id; changed++; }
  return changed;
}

/** 把已知能自动修的问题就地修掉：缺基本信息、preset 缺 pick、vocab 名字带禁字符。 */
function repairManifestLight(fig, id = PACK_ID) {
  let changed = ensureBasics(fig, id);
  for (const p of Array.isArray(fig.presets) ? fig.presets : []) {
    if (p && typeof p === 'object' && (!p.pick || typeof p.pick !== 'object')) { p.pick = {}; changed++; }
  }
  // console 若有但缺色（早期写过空对象），用默认青绿补齐
  const DEFAULT_HUES = {
    light: { a: '#0b7a5a', a2: '#0f9d76', on: '#ffffff', t: '#0b6b4f', c3: '#3f8f78', c4: '#8a8a90' },
    dark: { a: '#2fd3a0', a2: '#7fe6c2', on: '#062a20', t: '#8ae8c6', c3: '#5fbfa0', c4: '#9a9aa0' },
  };
  for (const p of Array.isArray(fig.presets) ? fig.presets : []) {
    if (!p || typeof p !== 'object' || !p.console || typeof p.console !== 'object') continue;
    for (const mode of ['light', 'dark']) {
      if (!p.console[mode] || typeof p.console[mode] !== 'object') { p.console[mode] = { ...DEFAULT_HUES[mode] }; changed++; continue; }
      for (const [k, v] of Object.entries(DEFAULT_HUES[mode])) {
        if (typeof p.console[mode][k] !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.console[mode][k])) { p.console[mode][k] = v; changed++; }
      }
    }
  }
  const BREAK = /[,，、\s【】<>＜＞]/g;
  for (const w of Array.isArray(fig.vocab) ? fig.vocab : []) {
    for (const [lang, list] of Object.entries(w?.names ?? {})) {
      if (!Array.isArray(list)) continue;
      const next = list.map((raw) => String(raw ?? '').replace(BREAK, '').trim().slice(0, 32) || String(w.id ?? ''));
      if (JSON.stringify(next) !== JSON.stringify(list)) { w.names[lang] = next; changed++; }
    }
  }
  return changed;
}

function packHealth(dir, id = PACK_ID) {
  const fig = readJson(join(dir, 'figure.json'), null);
  const states = ['state-idle', 'state-walk', 'state-drag', 'look-around']
    .filter((s) => existsSync(join(dir, 'actions', 'core', s, 'action.json')));
  const problem = fig && fig.id === id ? manifestProblem(fig) : 'figure.json 缺失或 id 不对';
  return {
    figureJson: !!fig && fig.id === id,
    player: existsSync(join(dir, 'figure.js')),
    states,
    problem,
    ok: !!fig && fig.id === id && existsSync(join(dir, 'figure.js')) && states.length === 4 && !problem,
  };
}

/** 这些形象包目录下所有声明自己是 `id` 的文件夹（用于查重）。 */
function packsClaimingId(roots, id = PACK_ID) {
  const out = [];
  for (const root of roots) {
    if (!root || !existsSync(root)) continue;
    let entries;
    try { entries = readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const path = join(root, e.name);
      const fig = readJson(join(path, 'figure.json'), null);
      if (fig && fig.id === id) out.push({ dir: e.name, path, root, bot: packHealth(path, id) });
    }
  }
  return out;
}

/** 把自带的形象包铺到 `dst`，并清成「空包」：没有额外动作，词表空。 */
function materialize(src, dst, id, log) {
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true, force: false, errorOnExist: false });
  rmSync(join(dst, '额外动作拓展'), { recursive: true, force: true });
  const fig = readJson(join(dst, 'figure.json'), { id });
  ensureBasics(fig, id);
  fig.id = id;
  fig.vocab = [];
  writeFileSync(join(dst, 'figure.json'), JSON.stringify(fig, null, 2) + '\n', 'utf8');
  log?.(`空的形象包已创建：${dst}`);
}

/** 只补缺的那部分：figure.js / figure.json / 状态段。 */
function repairInto(src, path, id, before, log) {
  if (!before.player) cpSync(join(src, 'figure.js'), join(path, 'figure.js'));
  if (!before.figureJson) {
    const fig = readJson(join(src, 'figure.json'), { id });
    fig.id = id;
    writeFileSync(join(path, 'figure.json'), JSON.stringify(fig, null, 2) + '\n', 'utf8');
  }
  for (const s of ['state-idle', 'state-walk', 'state-drag', 'look-around']) {
    if (!existsSync(join(path, 'actions', 'core', s, 'action.json'))) {
      cpSync(join(src, 'actions', 'core', s), join(path, 'actions', 'core', s), { recursive: true, force: false });
    }
  }
  log?.(`形象包缺文件，已补齐：${path}`);
}

/** `child` 是否真在 `root` 里面（不含 root 自己；挡 `..`、盘符、越界）。 */
const insideOf = (root, child) => {
  const rel = relative(resolve(root), resolve(child));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/**
 * 一键得到「空的深深形象包」：只有 4 段身体状态，没有额外动作、词表也是空的。
 *
 * 不给 `target` 时（老行为）保证同时只有一个：
 *   - 已经有（哪怕文件夹被改了名）→ 绝不再造一个，只把缺的东西补上；
 *   - 找到多个 → 不动任何文件，把重复的报出来让人自己删。
 *
 * 给了 `target`（面板里自选的位置）就按选的位置来：
 *   - 那个目录已经是包 → 就地修；
 *   - 否则在那个目录里造一个新的空包（`name` 同时作为目录名与 figure.json 的 id）；
 *   - 别的形象包根里若有同 id 的包，只报告，不动它们。
 *
 * @param {object} o
 * @param {string} o.pkgDir                 插件包根（找 assets/starter）
 * @param {() => string} [o.figuresDir]     主 figures 目录（老调用方式）
 * @param {() => string[]} [o.roots]        全部形象包根（新的调用方式，第一个当主目录）
 * @param {string} [o.target]               自选的落点（形象包目录本身，或某个根下的新目录）
 * @param {string} [o.name]                 新包名（目录名 + id），默认 shenshen-actions
 * @param {(msg: string) => void} [o.log]
 */
export function restorePack({ pkgDir, figuresDir, roots, target = '', name = PACK_ID, log }) {
  const rootList = (roots ? roots() : [figuresDir ? figuresDir() : ''])
    .filter((d) => typeof d === 'string' && d.trim());
  const primary = rootList[0] || '';
  const id = safePackName(name);
  const src = join(starterRoot(pkgDir), 'figure');
  if (!existsSync(join(src, 'figure.js'))) throw new Error('插件里没有自带形象包（assets/starter/figure 缺失）');

  const found = packsClaimingId(rootList, id);
  const wanted = typeof target === 'string' && target.trim() ? resolve(target.trim()) : '';
  const rootOf = (p) => rootList.find((r) => insideOf(r, p) || resolve(r) === resolve(p)) ?? '';

  /* 自选了位置：按选的位置来 */
  if (wanted) {
    if (!isAbsolute(wanted)) throw new Error(`选的目录要是绝对路径：${wanted}`);
    const isRoot = rootList.some((r) => resolve(r) === wanted);
    const dst = isRoot ? join(wanted, id) : wanted;
    if (!rootList.some((r) => insideOf(r, dst))) {
      throw new Error(`这个位置不在任何形象包目录里，桌宠看不到：${dst}（可选：${rootList.join('；')}）`);
    }
    const duplicates = found.filter((p) => resolve(p.path) !== resolve(dst)).map((p) => p.path);

    if (existsSync(join(dst, 'figure.json'))) {
      const healthyBefore = packHealth(dst, id).ok;
      // 先去修「能自动修」的那类毛病（preset 缺 pick / 词表名字带禁字符），再判健康
      {
        const fig = readJson(join(dst, 'figure.json'), null);
        if (fig && repairManifestLight(fig) > 0) {
          writeFileSync(join(dst, 'figure.json'), JSON.stringify(fig, null, 2) + '\n', 'utf8');
          log?.('修好了形象包清单里的小问题（宿主本来会拒绝加载）');
        }
      }
      const before = packHealth(dst, id);
      if (!before.ok) repairInto(src, dst, id, before, log);
      const after = packHealth(dst, id);
      log?.(`形象包已存在，未重复创建：${dst}`);
      return {
        ok: true, created: false, repaired: !healthyBefore && after.ok,
        path: dst, dir: basename(dst), root: rootOf(dst), duplicates, health: after,
      };
    }
    materialize(src, dst, id, log);
    return {
      ok: true, created: true, repaired: false,
      path: dst, dir: basename(dst), root: rootOf(dst), duplicates, health: packHealth(dst, id),
    };
  }

  /* 没给位置（老行为）：有就修，没有才建，绝不重复 */
  if (found.length) {
    const canonical = found.find((p) => p.dir === id) ?? null;
    const others = found.filter((p) => p.dir !== id);
    const t = canonical ?? found[0];
    const healthyBefore = t.bot.ok;
    // 先修「清单里能自动补的」（基本信息 / preset.pick / 词表名字），再补缺文件
    {
      const fig = readJson(join(t.path, 'figure.json'), null);
      if (fig && repairManifestLight(fig, id) > 0) {
        writeFileSync(join(t.path, 'figure.json'), JSON.stringify(fig, null, 2) + '\n', 'utf8');
        log?.('修好了形象包清单里的小问题（宿主本来会拒绝加载）');
      }
    }
    const before = packHealth(t.path, id);
    if (!before.ok) repairInto(src, t.path, id, before, log);
    const after = packHealth(t.path, id);
    log?.(`形象包已存在，未重复创建：${t.path}`);
    return {
      ok: true, created: false, repaired: !healthyBefore && after.ok,
      path: t.path, dir: t.dir, root: t.root ?? primary,
      duplicates: others.map((p) => p.path), health: after,
    };
  }

  if (!primary) throw new Error('不知道形象包目录在哪');
  mkdirSync(primary, { recursive: true });
  const dst = join(primary, id);
  materialize(src, dst, id, log);
  return {
    ok: true, created: true, repaired: false,
    path: dst, dir: id, root: primary, duplicates: [], health: packHealth(dst, id),
  };
}

/**
 * @param {{ pkgDir: string, figuresDir: () => string, dataDir: string, libraryDir: () => string, saveSettings: (patch: object) => void, log?: (msg: string, extra?: object) => void }} o
 */
export function ensureStarter(o) {
  const root = starterRoot(o.pkgDir);
  if (!existsSync(root)) return { pack: false, library: null, skipped: 'no-starter' };

  const out = { pack: false, library: null };

  /* 1) 形象包：默认**不自动造** —— 放哪儿由用户在面板里选（「建立空的形象包（选位置）」）。
     传 `seedPack: true` 才会静默铺一个到主 figures 目录（命令行/自测用）。 */
  const srcPack = join(root, 'figure');
  if (o.seedPack === true && existsSync(srcPack)) {
    let figures = '';
    try { figures = o.figuresDir(); } catch { figures = ''; }
    if (figures) {
      const dst = join(figures, PACK_ID);
      let taken = existsSync(join(dst, 'figure.json'));
      // 文件夹被改过名但 id 相同也算"已经有"，别再造第二个
      if (!taken) {
        try {
          taken = readdirSync(figures, { withFileTypes: true })
            .some((e) => e.isDirectory() && (readJson(join(figures, e.name, 'figure.json'), null)?.id === PACK_ID));
        } catch { taken = false; }
      }
      if (!taken) {
        mkdirSync(figures, { recursive: true });
        // 首次使用铺的也是「空壳」：只有 4 段身体状态，没有额外动作、词表空。
        // 语义是"勾选即全部" —— 用户勾哪些，桌宠才做哪些，不该由插件替他预选。
        materialize(srcPack, dst, PACK_ID, o.log);
        out.pack = true;
      }
    }
  }

  /* 2) 小动作库：**不自动铺**。
     放哪个盘由用户在面板里选，然后走 installStarterLibrary 在 `<用户选的目录>\深深-动作库` 建。
     这里一个字都不写：不建目录、不改 libraryDir —— 启动时不替用户做决定。
     用户设置过的库哪怕现在读不到（移动硬盘没插、网盘没挂），也照样不动设置。 */
  const srcLib = join(root, 'library');
  if (existsSync(srcLib) && existsSync(join(srcLib, 'actions'))) {
    const current = o.libraryDir();
    if (current && !existsSync(join(current, 'actions'))) {
      // 只提醒，不改设置：面板会显示「动作库目录没找到」并给出重新选择的入口
      out.libraryMissing = current;
      o.log?.('设置里的动作库现在读不到，保持原设置不动', { dir: current });
    }
  }

  return out;
}

/** 一个目录像不像动作库：有 actions/，且至少有一个模块带 action.json。读不到返回 null。 */
export function libraryHealth(dir) {
  try {
    if (!statSync(dir).isDirectory()) return null;
  } catch { return null; }
  if (!existsSync(join(dir, 'actions'))) return null;
  const modules = [];
  try {
    for (const cat of readdirSync(join(dir, 'actions'), { withFileTypes: true })) {
      if (!cat.isDirectory() || cat.name.startsWith('.')) continue;
      let mods;
      try { mods = readdirSync(join(dir, 'actions', cat.name), { withFileTypes: true }); } catch { continue; }
      for (const m of mods) {
        if (!m.isDirectory() || m.name.startsWith('.')) continue;
        const meta = readJson(join(dir, 'actions', cat.name, m.name, 'action.json'), null);
        if (meta) modules.push({ category: cat.name, id: String(meta.id ?? m.name) });
      }
    }
  } catch { /* 读不到就当空库 */ }
  return { dir, count: modules.length, categories: [...new Set(modules.map((m) => m.category))] };
}

/**
 * 在用户选的目录下建一个「自带示例动作库」（3 段）。
 * 沿用作者 0.3.9 的做法：目标固定为 `<parentDir>\深深-动作库`（名字固定，方便之后自己找到），已有则复用。
 */
export function installStarterLibrary({ pkgDir, parentDir, log }) {
  if (typeof parentDir !== 'string' || !parentDir.trim()) throw new Error('没有选择目录');
  if (!existsSync(parentDir)) throw new Error(`目录不存在：${parentDir}`);
  const src = join(starterRoot(pkgDir), 'library');
  if (!existsSync(join(src, 'actions'))) throw new Error('插件里没有自带动作库（assets/starter/library 缺失）');

  const dst = join(parentDir, '深深-动作库');
  if (existsSync(join(dst, 'actions'))) {
    log?.(`这个位置已经有动作库了，直接用它：${dst}`);
    return { created: false, path: dst };
  }
  cpSync(src, dst, { recursive: true, force: false, errorOnExist: false });
  log?.(`自带示例动作库已建在 ${dst}`);
  return { created: true, path: dst };
}


/**
 * 给「深深」这个形象包补一套控制台配色预设（宿主 console-theme.ts 的 figureSchemes）。
 *
 * 为什么需要：宿主对**没有 console 预设**的包，会把配色钉回 mint（配色方案里的第一个），
 * 用户在控制台换配色之后一切到深深就被改回去。补一套预设之后，切到深深 = 切到「深深 · 青绿」，
 * 而不是回落默认。
 *
 * 只对自己这个包（id = shenshen-actions）动手：只新增、不删除、不覆盖已有预设，
 * 改之前留 .bak，重复调用不会再写。
 */
export function ensureConsolePreset(packDir, log) {
  const id = safePackName(packDir);
  const figFile = join(packDir, 'figure.json');
  const fig = readJson(figFile, null);
  if (!fig || fig.id !== PACK_ID) return { changed: false, reason: 'not-our-pack' };
  const presets = Array.isArray(fig.presets) ? fig.presets : [];
  // 预设必须带 pick（宿主 packs.ts:330），缺了整包不加载 → 先补
  let repaired = 0;
  for (const p of presets) {
    if (p && typeof p === 'object' && (!p.pick || typeof p.pick !== 'object')) { p.pick = {}; repaired++; }
  }
  if (repaired) {
    const bak = join(packDir, 'figure.json.bak-配色2');
    if (!existsSync(bak)) writeFileSync(bak, readFileSync(figFile, 'utf8'), 'utf8');
    writeFileSync(figFile, JSON.stringify(fig, null, 2) + '\n', 'utf8');
    log?.('补上了形象包里缺失的 preset.pick（缺它整包都不会加载）');
  }
  if (presets.some((p) => p && p.console)) return { changed: repaired > 0, reason: repaired ? 'repaired-pick' : 'already-has-console' };
  if (presets.some((p) => p && p.id === CONSOLE_PRESET.id)) return { changed: false, reason: 'id-taken' };

  const backup = join(packDir, 'figure.json.bak-配色');
  if (!existsSync(backup)) writeFileSync(backup, readFileSync(figFile, 'utf8'), 'utf8');
  fig.presets = [CONSOLE_PRESET, ...presets];
  writeFileSync(figFile, JSON.stringify(fig, null, 2) + '\n', 'utf8');
  log?.('已给形象包补上控制台配色预设：深深 · 青绿');
  return { changed: true, preset: CONSOLE_PRESET.id };
}

/** 深深包的配色预设（对比度：浅色 on-accent 5.3:1、t/纸面 6.3:1；深色 8.1:1 / 11.4:1）。 */
export const CONSOLE_PRESET = {
  "id": "teal",
  "pick": {},
  "name": {
    "zh": "深深 · 青绿",
    "zh-Hant": "深深 · 青綠",
    "en": "Shenshen · Teal"
  },
  "accent": "#0b7a5a",
  "console": {
    "light": {
      "a": "#0b7a5a",
      "a2": "#0f9d76",
      "on": "#ffffff",
      "t": "#0b6b4f",
      "c3": "#3f8f78",
      "c4": "#8a8a90"
    },
    "dark": {
      "a": "#2fd3a0",
      "a2": "#7fe6c2",
      "on": "#062a20",
      "t": "#8ae8c6",
      "c3": "#5fbfa0",
      "c4": "#9a9aa0"
    }
  }
};

/**
 * 把「深深」这个形象包里的播放器升级到当前版本。
 *
 * 为什么需要：点击回应（戳一戳）的逻辑在 figure.js 里。老包里的播放器有三个问题 ——
 * 没有"没有点击段就随便挑一段"的兜底、回应会播满 10 秒、以及没有上限。
 * 只对自己这个包动手：内容没变（已有标记）就不写，改之前留 .bak-播放器。
 */
export function ensurePlayer(packDir, pkgDir, log) {
  const figFile = join(packDir, 'figure.json');
  const fig = readJson(figFile, null);
  if (!fig || fig.id !== PACK_ID) return { changed: false, reason: 'not-our-pack' };
  const entry = typeof fig.entry === 'string' && fig.entry ? fig.entry : 'figure.js';
  const target = join(packDir, entry);
  const src = join(starterRoot(pkgDir), 'figure', 'figure.js');
  if (!existsSync(src) || !existsSync(target)) return { changed: false, reason: 'no-player' };
  const now = readFileSync(target, 'utf8');
  const next = readFileSync(src, 'utf8');
  if (now === next || now.includes('REACTION_MAX')) return { changed: false, reason: 'up-to-date' };
  writeFileSync(join(packDir, entry + '.bak-播放器'), now, 'utf8');
  writeFileSync(target, next, 'utf8');
  log?.('形象包的播放器已升级（点击回应更灵敏）');
  return { changed: true };
}

/**
 * 修掉形象包里「宿主不认」的词表名字。
 *
 * 宿主 packs.ts 的 readVocab 有一条硬规则：名字里不能有 , ， 、 空白 【】 <> ＜＞，
 * 也不能超过 32 字、不能和别的词（含 id）重名。**只要有一条不合格，整份 vocab 被拒** ——
 * 表现是 bot 一个动作都点不出来（用户会说"某个动作为什么调用不出来"）。
 *
 * 我们早先的清单里有一个名字带逗号（是啊，吃什么），勾上它就会把整份词表拖坏。
 * 这里把已经是这种状态的老包修回来：只改 names，不动 id/kind/about/seconds，先备份，幂等。
 */
export function ensureVocabNames(packDir, log) {
  const figFile = join(packDir, 'figure.json');
  const fig = readJson(figFile, null);
  if (!fig || fig.id !== PACK_ID) return { changed: false, reason: 'not-our-pack' };
  const vocab = Array.isArray(fig.vocab) ? fig.vocab : [];
  if (!vocab.length) return { changed: false, reason: 'empty' };

  const BREAK = /[,，、\s【】<>＜＞]/g;
  // 宿主里 id 和名字共用一个命名空间：先把所有 id 占住，名字就不能等于任何 id（**包括自己的**）。
  // 老版本这里是「撞名就退回 id」—— 如果撞的正是自己的 id，退回 id 其实还是重名，等于没修。
  const taken = new Set(vocab.map((w) => String(w?.id ?? '')));
  const fixed = [];
  let changed = false;
  for (const w of vocab) {
    const next = JSON.parse(JSON.stringify(w));
    const id = String(next.id ?? '');
    const names = next.names && typeof next.names === 'object' ? next.names : {};
    for (const [lang, list] of Object.entries(names)) {
      if (!Array.isArray(list)) continue;
      names[lang] = list.map((raw) => {
        const cleaned = String(raw ?? '').replace(BREAK, '').trim().slice(0, 32);
        const name = uniqueName(cleaned || id, taken);   // 撞了就加 2、3…，始终 ≤ 32 字
        taken.add(name);
        return name;
      });
    }
    next.names = names;
    if (JSON.stringify(next) !== JSON.stringify(w)) changed = true;
    fixed.push(next);
  }
  if (!changed) return { changed: false, reason: 'already-clean' };

  writeFileSync(join(packDir, 'figure.json.bak-词表名'), readFileSync(figFile, 'utf8'), 'utf8');
  fig.vocab = fixed;
  writeFileSync(figFile, JSON.stringify(fig, null, 2) + '\n', 'utf8');
  syncManagedVocab(packDir, fixed, log);
  log?.('已修好形象包里宿主不认的词表名字（否则 bot 一个动作都点不出来）');
  return { changed: true };
}

/**
 * 修完名字要把「我们写下去的原文」同步进账本。
 *
 * `.managed.json` 的 `writtenVocab` 是保存/清空时判断「用户改过没有」的依据：
 * 不同步的话，我们自己改的名字会被当成用户编辑，于是永远保留 —— 清空动作之后
 * 还会剩下一个指向已删动作的词。
 */
function syncManagedVocab(packDir, vocab, log) {
  const file = join(packDir, EXTRA_DIR, MANAGED_FILE);
  const managed = readJson(file, null);
  if (!managed || typeof managed !== 'object') return false;
  managed.written = vocab.map((w) => w?.id);
  managed.writtenVocab = vocab;
  writeFileSync(file, JSON.stringify(managed, null, 2) + '\n', 'utf8');
  log?.('已把修好的名字同步进 .managed.json（免得下次被当成用户改动）');
  return true;
}
