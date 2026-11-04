/**
 * 在线取动作：**插件自己下载、自己解压、自己装进动作库**。
 * 用户不需要解压、不需要选文件夹 —— 这是"下载完了面板还是空的"那一类问题的根治。
 *
 * 下载源（Gitee / 任意静态站点）由 `remoteBase` 决定，布局约定：
 *   <remoteBase>/library.zip            完整动作库（和我们发的一致：actions/<分类>/<id>/{action.json,anim.webp}）
 *   <remoteBase>/actions/<分类>/<id>.zip 单个动作（zip 里是 action.json + anim.webp）
 *
 * 所有入口都过同一套校验：只认 https?://、限体积、只解 action.json / anim.webp / preview.webp / f_NNNN.webp，
 * 且落点必须在动作库目录里面。
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join, normalize, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { extractZip, listZip } from './zip.js';
import { extractTarGz } from './tar.js';

/** 维护者把 Gitee 仓库的 raw/下载前缀填这里（末尾不要带斜杠）。 */
export const DEFAULT_REMOTE = '';

/** 动作库的分片 npm 包（npmmirror 会自动镜像，国内直连）。sha256 用于完整性校验。 */
export const LIB_PARTS = [
  { name: 'cortico-world-shenshen-lib-1', version: '1.0.0', modules: 15, bytes: 51758812, sha256: 'db10bf40ae3078d087966b048fd1ab9704b16ffd99179e80799e75ddf2efc1ca' },
  { name: 'cortico-world-shenshen-lib-2', version: '1.0.0', modules: 15, bytes: 53693012, sha256: '541bb2ce6ee0ccc53aa9437213ec15e7b981ee0edb04b33037d941c235b6fcff' },
  { name: 'cortico-world-shenshen-lib-3', version: '1.0.0', modules: 15, bytes: 53643090, sha256: 'b4a908bf0c4fb778829e13ca230801d3110935104d6b5b2e692131372e946182' },
  { name: 'cortico-world-shenshen-lib-4', version: '1.0.0', modules: 13, bytes: 53889958, sha256: 'c528c70954cb20afb57568c85ada3b6af8ca274a059bde9c2cba8774e37f65fe' },
  { name: 'cortico-world-shenshen-lib-5', version: '1.0.0', modules: 13, bytes: 52249938, sha256: '575b60e97fe87198dc9794f3848b6cfd422238df081810ac7169c804cfa80212' },
  { name: 'cortico-world-shenshen-lib-6', version: '1.0.0', modules: 14, bytes: 51269171, sha256: '19b06067b724555e36633ba63f0696631287278447e78d4a0606509de4b03f64' },
  { name: 'cortico-world-shenshen-lib-7', version: '1.0.0', modules: 14, bytes: 51556774, sha256: 'a533d38e5504156539bbbdcf4bf231d6162f9033a83ab82317cd5c72be934a6e' },
  { name: 'cortico-world-shenshen-lib-8', version: '1.0.0', modules: 6, bytes: 20030747, sha256: 'ac8fdf8c0927369226ca09f646f2a8a40c167a954260670463c64727713d0a81' },
];

/** 分片 tarball 地址：国内优先 npmmirror，失败再退回官方 registry。 */
export const partTarballs = (p) => [
  `https://registry.npmmirror.com/${p.name}/-/${p.name}-${p.version}.tgz`,
  `https://registry.npmjs.org/${p.name}/-/${p.name}-${p.version}.tgz`,
];

const MAX_LIBRARY_BYTES = 800 * 1024 * 1024;     // 完整库上限
const MAX_ACTION_BYTES = 32 * 1024 * 1024;       // 单个动作上限
/** 没配 remoteBase 时的兜底：GitHub Release 上的完整库（国内可能慢，但不至于完全没有）。 */
/** 单段动作的兜底地址：GitHub Release 上的扁平资产 `<id>.zip`（Gitee 建好后用 remoteActionBase 覆盖）。 */
export const FALLBACK_ACTION_BASE = 'https://github.com/MOYU-AI-Lab/cortico-world-extra-actions/releases/download/per-action';

export const FALLBACK_LIBRARY = 'https://github.com/MOYU-AI-Lab/cortico-world-extra-actions/releases/download/library/shenshen-action-library.zip';
/** 只收这些条目：动作库的两种格式（帧序列 / 单文件动画）。 */
const WANT = /(^|\/)actions\/[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]*\/(action\.json|anim\.webp|preview\.webp|f_\d{4}\.webp)$/;

/** 所有条目共用的顶层目录（深深-动作库/），没有就返回空串。 */
function commonTop(names) {
  const files = names.filter((x) => x && !x.endsWith('/'));
  if (!files.length) return '';
  const first = files[0].split('/')[0];
  if (files[0].split('/').length < 2) return '';
  return files.every((x) => x.split('/')[0] === first) ? first + '/' : '';
}

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

async function fetchBytes(url, cap) {
  if (!isHttp(url)) throw new Error(`只支持 http(s) 地址：${url}`);
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`下载失败：HTTP ${r.status}`);
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len && len > cap) throw new Error(`文件太大（${(len / 1048576).toFixed(0)} MB）：${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > cap) throw new Error(`文件太大（${(buf.length / 1048576).toFixed(0)} MB）`);
  return buf;
}

/** 解压出来的动作模块里必须有 action.json；顺带把库根 index.js 重建。 */
function summarize(dir) {
  const mods = [];
  const actionsRoot = join(dir, 'actions');
  if (!existsSync(actionsRoot)) return mods;
  for (const cat of readdirSync(actionsRoot, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    for (const m of readdirSync(join(actionsRoot, cat.name), { withFileTypes: true })) {
      if (!m.isDirectory()) continue;
      if (existsSync(join(actionsRoot, cat.name, m.name, 'action.json'))) mods.push(`${cat.name}/${m.name}`);
    }
  }
  return mods;
}

/**
 * 完整动作库：下载 zip → 解到动作库里（已有就覆盖同名文件，不动别的）。
 * @returns {{ ok: boolean, path: string, modules: number, bytes: number, skipped: number }}
 */
export async function installLibrary({ url, libraryDir, dataDir, log }) {
  let dest = libraryDir && isAbsolute(libraryDir) && existsSync(libraryDir) ? libraryDir : '';
  if (!dest) {
    dest = join(dataDir, 'shenshen-library');
    mkdirSync(dest, { recursive: true });
  }
  const buf = await fetchBytes(url, MAX_LIBRARY_BYTES);
  log?.(`已下载 ${(buf.length / 1048576).toFixed(1)} MB，开始解压…`);

  const before = new Set(summarize(dest));
  const top = commonTop(listZip(buf).map((e) => e.name));
  const r = extractZip(buf, {
    dest,
    // 动作库 zip 一般带一层 `深深-动作库/`：剥掉，直接落到 actions/ 下
    mapPath: (rel) => (top && rel.startsWith(top) ? rel.slice(top.length) : rel),
    onFile: (rel) => WANT.test(rel),
  });
  if (!r.files.length) throw new Error('这个 zip 里没有动作（不是我们发的动作库？）');

  let mods = summarize(dest);
  const added = mods.filter((m) => !before.has(m));
  log?.(`解压 ${r.files.length} 个文件；动作库现有 ${mods.length} 段（新增 ${added.length}）`);
  return { ok: true, path: dest, modules: mods.length, added: added.length, bytes: buf.length, skipped: r.skipped, files: r.files.length };
}

/**
 * 单个动作：下载 `<base>/actions/<分类>/<id>.zip`，解到 `<库>/actions/<分类>/<id>/`。
 * 只允许落在库目录内。
 */
export async function installAction({ url, libraryDir, category, id, log }) {
  if (!libraryDir || !isAbsolute(libraryDir) || !existsSync(libraryDir)) throw new Error('动作库还没设置好');
  if (!/^[a-z][a-z0-9-]{0,15}$/.test(String(category ?? ''))) throw new Error('分类不合法');
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(String(id ?? ''))) throw new Error('id 不合法');

  const dest = join(libraryDir, 'actions', category, id);
  const root = normalize(join(libraryDir, 'actions') + sep);
  if (!normalize(dest + sep).startsWith(root)) throw new Error('落点越界');

  const buf = await fetchBytes(url, MAX_ACTION_BYTES);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const r = extractZip(buf, { dest, onFile: (rel) => !rel.includes('/') && /^(action\.json|anim\.webp|preview\.webp|f_\d{4}\.webp)$/.test(rel) });
  if (!existsSync(join(dest, 'action.json'))) throw new Error('这个 zip 里没有 action.json');
  log?.(`单个动作已装：${category}/${id}（${r.files.length} 个文件）`);
  return { ok: true, path: dest, files: r.files.length, bytes: buf.length };
}

/** 由 remoteBase 拼出两个地址。 */
export const libraryUrl = (base) => `${String(base).replace(/\/+$/, '')}/library.zip`;
export const actionUrl = (base, category, id) => `${String(base).replace(/\/+$/, '')}/actions/${category}/${id}.zip`;
/** 扁平布局（GitHub Release 的资产做不到子目录）：<base>/<id>.zip */
export const flatActionUrl = (base, id) => `${String(base).replace(/\/+$/, '')}/${id}.zip`;


/**
 * 分片安装：逐个下载 npm 包 tarball → 校验 sha256 → 解压进动作库。
 * 一片失败不影响已装好的；返回装了哪些模块。
 */
export async function installLibraryParts({ parts = LIB_PARTS, dest, log, onProgress }) {
  mkdirSync(dest, { recursive: true });
  const before = new Set(summarize(dest));
  let bytes = 0;
  let failed = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    let buf = null;
    let lastErr = null;
    for (const url of partTarballs(p)) {
      try { buf = await fetchBytes(url, MAX_LIBRARY_BYTES); break; } catch (e) { lastErr = e; }
    }
    if (!buf) { failed++; log?.(`第 ${i + 1} 片下载失败：${lastErr?.message ?? '未知错误'}`); continue; }
    bytes += buf.length;
    if (p.sha256) {
      const got = createHash('sha256').update(buf).digest('hex');
      if (got !== p.sha256) { failed++; log?.(`第 ${i + 1} 片校验不通过，已跳过`); continue; }
    }
    const r = extractTarGz(buf, {
      dest,
      mapPath: (rel) => (rel.startsWith('package/') ? rel.slice(8) : rel),
      onFile: (rel) => WANT.test(rel),
    });
    log?.(`第 ${i + 1}/${parts.length} 片：${r.files.length} 个文件`);
    onProgress?.(i + 1, parts.length);
  }
  const mods = summarize(dest);
  const added = mods.filter((m) => !before.has(m));
  return { ok: failed === 0, path: dest, modules: mods.length, added: added.length, failed, bytes };
}
