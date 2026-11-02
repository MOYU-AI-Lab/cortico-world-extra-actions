/**
 * 自带素材的落地：插件里打包了一份「入门套装」，第一次启动时铺到磁盘上。
 *
 * - 形象包 → `<figures>/shenshen-actions`（只在不存在时铺，绝不覆盖用户自己改过的）
 * - 小动作库 → `<dataDir>/shenshen-library`（只在动作库没设置/不在了的时候铺，并写进设置）
 *
 * 这样装完插件就有东西可勾；105 段全量动作库仍然可以在面板里「选择动作库…」指过去。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PACK_ID = 'shenshen-actions';

/** 内置素材的根目录：<包>/assets/starter */
const starterRoot = (pkgDir) => join(pkgDir, 'assets', 'starter');

const readJson = (file, fallback = null) => {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
};

/** 这个包里该有的东西齐不齐。 */
function packHealth(dir) {
  const fig = readJson(join(dir, 'figure.json'), null);
  const states = ['state-idle', 'state-walk', 'state-drag', 'look-around']
    .filter((s) => existsSync(join(dir, 'actions', 'core', s, 'action.json')));
  return {
    figureJson: !!fig && fig.id === PACK_ID,
    player: existsSync(join(dir, 'figure.js')),
    states,
    ok: !!fig && fig.id === PACK_ID && existsSync(join(dir, 'figure.js')) && states.length === 4,
  };
}

/** figures 目录下所有声明自己是 shenshen-actions 的文件夹（用于查重）。 */
function packsClaimingId(figures) {
  const out = [];
  if (!existsSync(figures)) return out;
  for (const e of readdirSync(figures, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const fig = readJson(join(figures, e.name, 'figure.json'), null);
    if (fig && fig.id === PACK_ID) out.push({ dir: e.name, path: join(figures, e.name), bot: packHealth(join(figures, e.name)) });
  }
  return out;
}

/**
 * 一键得到「空的深深形象包」：只有 4 段身体状态，没有额外动作、词表也是空的。
 *
 * 保证同时只有一个：
 *   - 已经有（哪怕文件夹被改了名）→ 绝不再造一个，只把缺的东西补上；
 *   - 找到多个 → 不动任何文件，把重复的报出来让人自己删。
 */
export function restorePack({ pkgDir, figuresDir, log }) {
  const figures = figuresDir();
  const src = join(starterRoot(pkgDir), 'figure');
  if (!existsSync(join(src, 'figure.js'))) throw new Error('插件里没有自带形象包（assets/starter/figure 缺失）');

  const found = packsClaimingId(figures);
  const canonical = found.find((p) => p.dir === PACK_ID) ?? null;
  const others = found.filter((p) => p.dir !== PACK_ID);

  /* 已经有：修一修（缺了才补），绝不重复造 */
  if (found.length) {
    const target = canonical ?? found[0];
    const before = target.bot;
    if (!before.ok) {
      // 只补缺的那部分：figure.js / figure.json / 状态段
      if (!before.player) cpSync(join(src, 'figure.js'), join(target.path, 'figure.js'));
      if (!before.figureJson) {
        const fig = readJson(join(src, 'figure.json'), { id: PACK_ID });
        writeFileSync(join(target.path, 'figure.json'), JSON.stringify(fig, null, 2) + '\n', 'utf8');
      }
      for (const s of ['state-idle', 'state-walk', 'state-drag', 'look-around']) {
        if (!existsSync(join(target.path, 'actions', 'core', s, 'action.json'))) {
          cpSync(join(src, 'actions', 'core', s), join(target.path, 'actions', 'core', s), { recursive: true, force: false });
        }
      }
    }
    const after = packHealth(target.path);
    log?.(`形象包已存在，未重复创建：${target.path}`);
    return {
      ok: true,
      created: false,
      repaired: !before.ok && after.ok,
      path: target.path,
      dir: target.dir,
      duplicates: others.map((p) => p.path),
      health: after,
    };
  }

  /* 没有：造一个空的 */
  mkdirSync(figures, { recursive: true });
  const dst = join(figures, PACK_ID);
  cpSync(src, dst, { recursive: true, force: false, errorOnExist: false });
  // 清空额外动作与词表 —— "空的"形象包
  rmSync(join(dst, '额外动作拓展'), { recursive: true, force: true });
  const fig = readJson(join(dst, 'figure.json'), { id: PACK_ID });
  fig.vocab = [];
  writeFileSync(join(dst, 'figure.json'), JSON.stringify(fig, null, 2) + '\n', 'utf8');
  log?.(`空的形象包已创建：${dst}`);
  return { ok: true, created: true, repaired: false, path: dst, dir: PACK_ID, duplicates: [], health: packHealth(dst) };
}

/**
 * @param {{ pkgDir: string, figuresDir: () => string, dataDir: string, libraryDir: () => string, saveSettings: (patch: object) => void, log?: (msg: string, extra?: object) => void }} o
 */
export function ensureStarter(o) {
  const root = starterRoot(o.pkgDir);
  if (!existsSync(root)) return { pack: false, library: null, skipped: 'no-starter' };

  const out = { pack: false, library: null };

  /* 1) 形象包 */
  const srcPack = join(root, 'figure');
  if (existsSync(srcPack)) {
    let figures = '';
    try { figures = o.figuresDir(); } catch { figures = ''; }
    if (figures) {
      const dst = join(figures, PACK_ID);
      if (!existsSync(join(dst, 'figure.json'))) {
        mkdirSync(figures, { recursive: true });
        cpSync(srcPack, dst, { recursive: true, force: false, errorOnExist: false });
        out.pack = true;
        o.log?.(`自带形象包已铺到 ${dst}`);
      }
    }
  }

  /* 2) 小动作库 */
  const srcLib = join(root, 'library');
  if (existsSync(srcLib) && existsSync(join(srcLib, 'actions'))) {
    const current = o.libraryDir();
    if (!current || !existsSync(join(current, 'actions'))) {
      const dst = join(o.dataDir, 'shenshen-library');
      if (!existsSync(join(dst, 'actions'))) {
        cpSync(srcLib, dst, { recursive: true, force: false, errorOnExist: false });
      }
      o.saveSettings({ libraryDir: dst });
      out.library = dst;
      o.log?.(`自带动作库已铺到 ${dst}`);
    }
  }

  return out;
}
