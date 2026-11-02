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

/** 一个模块目录的体检 + 元数据；返回 { error } 或 { ok }。 */
function inspectModule(dir, existingIds) {
  const frames = framesIn(dir);
  if (frames.length < 2) return { error: '里面没有 f_0001.webp… 这样的帧（至少 2 张）' };
  if (frames.length > MAX_FRAMES) return { error: `帧太多（${frames.length}，上限 ${MAX_FRAMES}）` };

  let size = 0;
  let dims = null;
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

  const meta = readJson(join(dir, 'action.json'), null) || {};
  const wantId = typeof meta.id === 'string' ? meta.id : '';
  const baseId = SAFE_ID.test(wantId) ? wantId : slugOf(meta.id || basename(dir));
  const category = SAFE_CAT.test(String(meta.category ?? '')) ? String(meta.category) : NEW_CATEGORY;
  const zh = cleanLabel(meta.zh || meta.name || basename(dir)) || basename(dir);
  const fps = Number.isFinite(meta.fps) && meta.fps > 0 && meta.fps <= 60 ? Math.round(meta.fps) : 24;

  let id = baseId || 'extra';
  let n = 2;
  while (existingIds.has(id)) { id = `${baseId || 'extra'}-${n++}`.slice(0, 32); }
  if (!SAFE_ID.test(id)) id = `extra-${Date.now().toString(36)}`;

  return {
    ok: {
      id,
      zh: zh.slice(0, 32),
      category,
      fps,
      frames: frames.length,
      seconds: Math.round((frames.length / fps) * 1000) / 1000,
      bytes: size,
      files: frames,
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

/** 源目录下的候选模块：自己就是一组帧，或者一层子目录各是一组。 */
function candidatesIn(sourceDir) {
  if (framesIn(sourceDir).length) return [sourceDir];
  const out = [];
  for (const e of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    if (framesIn(join(sourceDir, e.name)).length) out.push(join(sourceDir, e.name));
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
      out.set(meta.id, {
        ...meta,
        category: SAFE_CAT.test(String(meta.category ?? '')) ? String(meta.category) : cat.name,
        catZh: meta.catZh ?? meta.category ?? cat.name,
        clip: `actions/${cat.name}/${mod.name}`,
        frames,
        fps,
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
 * @param {{ sourceDir: string, libraryDir: string, existingIds?: Set<string>, thumbFor?: (files: string[], dir: string) => string|null }} o
 */
export function addModules({ sourceDir, libraryDir, existingIds = new Set(), thumbFor = null }) {
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
    const r = inspectModule(dir, ids);
    if (r.error) { skipped.push({ dir: relative(sourceDir, dir) || '.', reason: r.error }); continue; }
    const m = r.ok;
    const dst = join(actionsRoot, m.category, m.id);
    if (!isInside(actionsRoot, dst)) { skipped.push({ dir: m.id, reason: '路径越界' }); continue; }
    if (existsSync(dst)) { skipped.push({ dir: m.id, reason: '库里已经有同名模块' }); continue; }

    mkdirSync(dst, { recursive: true });
    m.files.forEach((name, i) => {
      copyFileSync(join(dir, name), join(dst, `f_${String(i + 1).padStart(4, '0')}.webp`));
    });
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
