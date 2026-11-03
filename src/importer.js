/**
 * 「添加更多动作」—— 把用户自己的一套帧变成动作库里的一个模块。
 *
 * 输入：一个文件夹（里面是 f_0001.webp…，可选 action.json）；或者一个装着若干这种文件夹的父目录。
 * 输出：`<库>/actions/<分类>/<id>/` 一个自足模块 + `actions/index.js` 里多一行。
 *
 * 安全约束和 writer.js 一致：只写库目录里面的东西、只收 f_NNNN.webp、拒绝符号链接与超大文件、
 * id/分类过白名单、生成的清单里所有字符串走 JSON.stringify。
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { cleanLabel, isInside } from './writer.js';

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SAFE_CAT = /^[a-z][a-z0-9-]{0,15}$/;
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_FRAMES = 2000;
const MAX_MODULE_BYTES = 128 * 1024 * 1024;
const NEW_CATEGORY = 'extra';

const readJson = (file, fallback = null) => {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
};

/** 目录名 → ascii slug（中文名去不出来就退回 extra-NN，由调用方补序号）。 */
function slugOf(name) {
  const s = String(name ?? '').toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return SAFE_ID.test(s) ? s : '';
}

/** 一个目录里的帧文件（只认 f_NNNN.webp）。 */
function framesIn(dir) {
  try {
    return readdirSync(dir).filter((n) => /^f_\d{4}\.webp$/.test(n)).sort();
  } catch { return []; }
}

/** 一个模块目录的体检 + 元数据；返回 { error } 或 { ok }。`fixedCategory(id)` 用来把目录名钉死在清单上。 */
function inspectModule(dir, existingIds, fixedCategory = null) {
  const meta0 = readJson(join(dir, 'action.json'), null) || {};
  const frames = framesIn(dir);
  /* 单文件动画模块：一个 anim.webp 顶整段（高清库用的就是这种） */
  const animSt = lstatSync(join(dir, 'anim.webp'), { throwIfNoEntry: false });
  const single = !!animSt && animSt.isFile();

  let size = 0;
  let dims = null;
  if (single) {
    if (animSt.isSymbolicLink()) return { error: 'anim.webp 是符号链接，拒绝' };
    if (animSt.size <= 0 || animSt.size > MAX_MODULE_BYTES) return { error: `anim.webp 大小异常（${animSt.size} 字节）` };
    size = animSt.size;
    dims = webpSize(readFileSync(join(dir, 'anim.webp')).subarray(0, 40));
    if (!dims) return { error: 'anim.webp 不是 webp' };
  } else {
    if (frames.length < 2) return { error: '里面没有 f_0001.webp… 这样的帧（至少 2 张）' };
    if (frames.length > MAX_FRAMES) return { error: `帧太多（${frames.length}，上限 ${MAX_FRAMES}）` };
    for (const name of frames) {
      const full = join(dir, name);
      const st = lstatSync(full, { throwIfNoEntry: false });
      if (!st) return { error: `读不到 ${name}` };
      if (st.isSymbolicLink()) return { error: `${name} 是符号链接，拒绝` };
      if (!st.isFile()) return { error: `${name} 不是普通文件` };
      if (st.size <= 0 || st.size > MAX_FRAME_BYTES) return { error: `${name} 大小异常（${st.size} 字节）` };
      size += st.size;
      if (!dims) {
        const head = readFileSync(full).subarray(0, 40);
        dims = webpSize(head);            // 只读头，别为了一张图把整个文件解出来
        if (!dims) return { error: `${name} 不是 webp` };
      }
    }
    if (size > MAX_MODULE_BYTES) return { error: `整个模块超过 ${MAX_MODULE_BYTES / 1024 / 1024} MB` };
  }

  const meta = meta0;
  const wantId = typeof meta.id === 'string' ? meta.id : '';
  const baseId = SAFE_ID.test(wantId) ? wantId : slugOf(meta.id || basename(dir));
  // 目录固定：清单里已有的 id 一律用它登记的分类，保证落在 actions/<固定分类>/<id>/
  const fixed = typeof fixedCategory === 'function' ? fixedCategory(baseId) : null;
  const category = SAFE_CAT.test(String(fixed ?? '')) ? String(fixed)
    : SAFE_CAT.test(String(meta.category ?? '')) ? String(meta.category) : NEW_CATEGORY;
  const zh = cleanLabel(meta.zh || meta.name || basename(dir)) || basename(dir);
  const fps = Number.isFinite(meta.fps) && meta.fps > 0 && meta.fps <= 60 ? Math.round(meta.fps) : 24;

  let id = baseId || 'extra';
  let n = 2;
  while (existingIds.has(id)) { id = `${baseId || 'extra'}-${n++}`.slice(0, 32); }
  if (!SAFE_ID.test(id)) id = `extra-${Date.now().toString(36)}`;

  // 单文件模块没有帧文件，帧数按 action.json 声明（没有就按 241 的惯例）
  const frameCount = single
    ? (Number(meta.frames) > 0 ? Math.min(Number(meta.frames), MAX_FRAMES) : 241)
    : frames.length;

  return {
    ok: {
      id,
      zh: zh.slice(0, 32),
      category,
      fps,
      frames: frameCount,
      seconds: Math.round((frameCount / fps) * 1000) / 1000,
      bytes: size,
      files: single ? ['anim.webp'] : frames,
      single,
      dims,
      noMirror: meta.noMirror === true,
      reaction: meta.reaction === true,
      random: meta.random !== false,
    },
  };
}

/** 从 webp 头部读尺寸（VP8 / VP8L / VP8X）。读不出来返回 null。 */
function webpSize(buf) {
  try {
    if (buf.length < 30) return null;
    const riff = buf.toString('ascii', 0, 4);
    const webp = buf.toString('ascii', 8, 12);
    if (riff !== 'RIFF' || webp !== 'WEBP') return null;
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8 ') {
      return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    }
    if (kind === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { w, h };
    }
  } catch { /* 头不完整 */ }
  return null;
}

/** 一个目录是不是"一个动作模块"：帧序列（f_NNNN）或单文件动画（anim.webp）都算。 */
const looksLikeModule = (dir) => framesIn(dir).length > 0 || existsSync(join(dir, 'anim.webp'));

/** 源目录下的候选模块：自己就是一个模块，或者一层子目录各是一个模块。 */
function candidatesIn(sourceDir) {
  if (looksLikeModule(sourceDir)) return [sourceDir];
  const out = [];
  for (const e of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    if (looksLikeModule(join(sourceDir, e.name))) out.push(join(sourceDir, e.name));
  }
  return out;
}

/**
 * 扫库：`actions/<分类>/<模块>/action.json` 是**唯一真相**。
 * 返回 id → 条目（clip / 分类 / 时长都按目录和 action.json 归一化）。
 */
export function scanLibrary(libraryDir) {
  const out = new Map();
  const root = join(libraryDir, 'actions');
  if (!existsSync(root)) return out;
  for (const cat of readdirSync(root, { withFileTypes: true })) {
    if (!cat.isDirectory() || cat.name.startsWith('.')) continue;
    for (const mod of readdirSync(join(root, cat.name), { withFileTypes: true })) {
      if (!mod.isDirectory() || mod.name.startsWith('.')) continue;
      const dir = join(root, cat.name, mod.name);
      const meta = readJson(join(dir, 'action.json'), null);
      if (!meta || typeof meta.id !== 'string') continue;
      const frames = Number(meta.frames) > 0 ? Number(meta.frames) : framesIn(dir).length;
      const fps = Number(meta.fps) > 0 ? Number(meta.fps) : 24;
      const single = existsSync(join(dir, 'anim.webp'));      // 单文件动画模块（高清库是这种格式）
      out.set(meta.id, {
        ...meta,
        category: SAFE_CAT.test(String(meta.category ?? '')) ? String(meta.category) : cat.name,
        catZh: meta.catZh ?? meta.category ?? cat.name,
        clip: `actions/${cat.name}/${mod.name}`,
        frames,
        fps,
        anim: single || meta.anim === true,
        seconds: Number(meta.seconds) > 0 ? Number(meta.seconds) : Math.round((frames / fps) * 1000) / 1000,
      });
    }
  }
  return out;
}

/** 从 index.js 里按出现顺序取 id（生成用，不改语义）。 */
function indexOrder(libraryDir) {
  const file = join(libraryDir, 'actions', 'index.js');
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/\{ id: ['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

const indexLine = (e) => `  { id: ${JSON.stringify(e.id)}, zh: ${JSON.stringify(e.zh)}, category: ${JSON.stringify(e.category)},`
  + ` clip: ${JSON.stringify(e.clip)}, frames: ${Number(e.frames)}, fps: ${Number(e.fps)}, seconds: ${Number(e.seconds)},`
  + ` word: ${JSON.stringify(e.word ?? null)}, say: ${JSON.stringify(e.say ?? null)}, roles: ${JSON.stringify(e.roles ?? [])},`
  + ` anim: ${e.anim === true ? 'true' : 'false'},`
  + ` noMirror: ${e.noMirror ? 'true' : 'false'}, reaction: ${e.reaction ? 'true' : 'false'}, random: ${e.random === false ? 'false' : 'true'} },`;

/**
 * 由 action.json 重新生成 `actions/index.js`。
 * 已有顺序保留（不扰动手工排过的表），新模块追加在后面并按 id 排序。
 * 这个函数是"清单对不上"的万能修复：跑一遍，磁盘就是真相。
 */
export function rebuildIndex(libraryDir) {
  const mods = scanLibrary(libraryDir);
  const order = indexOrder(libraryDir);
  const seen = new Set(order.filter((id) => mods.has(id)));
  const ids = [...seen];
  for (const id of [...mods.keys()].sort()) if (!seen.has(id)) ids.push(id);
  const body = ids.map((id) => indexLine(mods.get(id))).join('\n');
  const text = `export default [\n${body}\n];\n`;
  const file = join(libraryDir, 'actions', 'index.js');
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const changed = before !== text;
  if (changed) writeFileSync(file, text, 'utf8');
  return { count: ids.length, changed };
}

/**
 * @param {{
 *   sourceDir: string, libraryDir: string, existingIds?: Set<string>,
 *   thumbFor?: (files: string[], dir: string) => string|null,
 *   fixedCategory?: (id: string) => string|null,
 * }} o
 * `fixedCategory`：清单里登记过的 id → 它固定该落在哪个分类目录；给了就优先于 action.json 里的分类。
 */
export function addModules({ sourceDir, libraryDir, existingIds = new Set(), thumbFor = null, fixedCategory = null }) {
  if (typeof sourceDir !== 'string' || !isAbsolute(sourceDir)) throw new Error(`源目录要是绝对路径：${sourceDir}`);
  if (typeof libraryDir !== 'string' || !isAbsolute(libraryDir)) throw new Error('动作库目录不合法');
  if (!existsSync(sourceDir)) throw new Error(`目录不存在：${sourceDir}`);
  if (!statSync(sourceDir).isDirectory()) throw new Error(`不是目录：${sourceDir}`);
  const actionsRoot = join(libraryDir, 'actions');
  if (!existsSync(actionsRoot)) throw new Error(`这个库没有 actions/：${libraryDir}`);

  const dirs = candidatesIn(sourceDir);
  if (!dirs.length) throw new Error('这个目录里没有动作帧（f_0001.webp…），也没有装着它们的子目录');

  const added = [];
  const skipped = [];
  const ids = new Set(existingIds);
  for (const dir of dirs) {
    const r = inspectModule(dir, ids, fixedCategory);
    if (r.error) { skipped.push({ dir: relative(sourceDir, dir) || '.', reason: r.error }); continue; }
    const m = r.ok;
    const dst = join(actionsRoot, m.category, m.id);
    if (!isInside(actionsRoot, dst)) { skipped.push({ dir: m.id, reason: '路径越界' }); continue; }
    if (existsSync(dst)) { skipped.push({ dir: m.id, reason: '库里已经有同名模块' }); continue; }

    mkdirSync(dst, { recursive: true });
    if (m.single) {
      // 单文件动画：原样搬一个 anim.webp，不拆帧
      copyFileSync(join(dir, 'anim.webp'), join(dst, 'anim.webp'));
      const preview = join(dir, 'preview.webp');
      if (existsSync(preview)) copyFileSync(preview, join(dst, 'preview.webp'));
    } else {
      m.files.forEach((name, i) => {
        copyFileSync(join(dir, name), join(dst, `f_${String(i + 1).padStart(4, '0')}.webp`));
      });
    }
    const thumb = thumbFor ? thumbFor(m.files, dir) : null;
    const entry = {
      id: m.id,
      zh: m.zh,
      say: m.zh,
      category: m.category,
      catZh: m.category,
      clip: `actions/${m.category}/${m.id}`,
      frames: m.frames,
      fps: m.fps,
      seconds: m.seconds,
      anim: !!m.single,
      word: m.id,
      roles: [],
      noMirror: m.noMirror,
      reaction: m.reaction,
      random: m.random,
      bytes: m.bytes,
      imported: true,
      ...(thumb ? { thumb } : {}),
    };
    writeFileSync(join(dst, 'action.json'), JSON.stringify(entry, null, 2) + '\n', 'utf8');
    added.push(entry);
    ids.add(m.id);
  }

  // 清单由 action.json 重新生成 —— 不追加，避免"索引和磁盘各说各话"
  if (added.length) rebuildIndex(libraryDir);
  return { added, skipped };
}
