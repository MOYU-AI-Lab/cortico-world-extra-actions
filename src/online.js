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
import { extractZip, listZip } from './zip.js';

/** 维护者把 Gitee 仓库的 raw/下载前缀填这里（末尾不要带斜杠）。 */
export const DEFAULT_REMOTE = '';

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
