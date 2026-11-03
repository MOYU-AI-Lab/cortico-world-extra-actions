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
function packHealth(dir, id = PACK_ID) {
  const fig = readJson(join(dir, 'figure.json'), null);
  const states = ['state-idle', 'state-walk', 'state-drag', 'look-around']
    .filter((s) => existsSync(join(dir, 'actions', 'core', s, 'action.json')));
  return {
    figureJson: !!fig && fig.id === id,
    player: existsSync(join(dir, 'figure.js')),
    states,
    ok: !!fig && fig.id === id && existsSync(join(dir, 'figure.js')) && states.length === 4,
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
      const before = packHealth(dst, id);
      if (!before.ok) repairInto(src, dst, id, before, log);
      const after = packHealth(dst, id);
      log?.(`形象包已存在，未重复创建：${dst}`);
      return {
        ok: true, created: false, repaired: !before.ok && after.ok,
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
    const before = t.bot;
    if (!before.ok) repairInto(src, t.path, id, before, log);
    const after = packHealth(t.path, id);
    log?.(`形象包已存在，未重复创建：${t.path}`);
    return {
      ok: true, created: false, repaired: !before.ok && after.ok,
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
