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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { isAbsolute, join, normalize, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { extractZip, listZip } from './zip.js';
import { extractTarGz } from './tar.js';

/** 维护者把 Gitee 仓库的 raw/下载前缀填这里（末尾不要带斜杠）。 */
export const DEFAULT_REMOTE = '';

/** 动作库分片：主源 Gitee（国内直连快），sha256 用于完整性校验。 */
export const LIB_PARTS_LITE = [
  { name: 'cortico-world-shenshen-lib-1', version: '2.0.0', modules: 13, bytes: 49678723, sha256: 'd7a9df29f08fe4b4e9e2d8c497dac4c6b1ec0fcb0d7ca0caafbd31baf2009bbb',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library/lib-1.tgz' },
  { name: 'cortico-world-shenshen-lib-2', version: '2.0.0', modules: 13, bytes: 48084515, sha256: '0fae5cc019abfed16141cbb04b5f53336ef18061550c064d837f67e72550920f',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library/lib-2.tgz' },
  { name: 'cortico-world-shenshen-lib-3', version: '2.0.0', modules: 13, bytes: 48050776, sha256: '4879caacca4834bd7aff4eb9a114f67f7f038e8d81dc82f64a5a36964ab6a6a5',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library/lib-3.tgz' },
  { name: 'cortico-world-shenshen-lib-4', version: '2.0.0', modules: 13, bytes: 48248312, sha256: 'd8b95e7ad16a028371c8315de54d9e27c4ce9793ed570d1074ec4d1f140a90aa',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library/lib-4.tgz' },
  { name: 'cortico-world-shenshen-lib-5', version: '2.0.0', modules: 13, bytes: 48134343, sha256: 'e1502cec9b2474c919b60f32510d0b5c93b759a5a7f17b37ca25992752cf2722',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library/lib-5.tgz' },
  { name: 'cortico-world-shenshen-lib-6', version: '2.0.0', modules: 13, bytes: 48027441, sha256: '98d127bbd498a036c067f0414102bacb4ca2a7700bb703570d9e5dd10353f99e',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library/lib-6.tgz' },
  { name: 'cortico-world-shenshen-lib-7', version: '2.0.0', modules: 13, bytes: 48043684, sha256: '55535088cda6bd06744ee80242a714fcbc8eb4c9ad20d0444258f94013eca9d4',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library/lib-7.tgz' },
  { name: 'cortico-world-shenshen-lib-8', version: '2.0.0', modules: 14, bytes: 49850903, sha256: 'f530a995ce411212817f8653d8417d8b9723bafbd5e5b2a90a6d47a6daa95cfd',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library/lib-8.tgz' },
];

export const LIB_PARTS_FULL = [
  { name: 'cortico-world-shenshen-lib-1', version: '2.0.0', modules: 6, bytes: 77101019, sha256: '8dcdd2fdb2fc46b973e5b8a0d2e785c39c3f316b7f8ba1d51be20f9d74532b71',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library-full/lib-1.tgz' },
  { name: 'cortico-world-shenshen-lib-2', version: '2.0.0', modules: 6, bytes: 77098261, sha256: 'bcd710d808eae1ece423d8be7e00b42b9f3ad9b0f54534d0b2831e77a17f2d45',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library-full/lib-2.tgz' },
  { name: 'cortico-world-shenshen-lib-3', version: '2.0.0', modules: 6, bytes: 76861667, sha256: '81bc99ae7d61b9982e07b16630526b74d7eae2e88a3df418670494ff7659e540',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library-full/lib-3.tgz' },
  { name: 'cortico-world-shenshen-lib-4', version: '2.0.0', modules: 6, bytes: 76842738, sha256: 'a0f240fb8fce648acdbd6f04a23581adacdafc5344e7de4f653ff9913a7d6c7f',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library-full/lib-4.tgz' },
  { name: 'cortico-world-shenshen-lib-5', version: '2.0.0', modules: 6, bytes: 75712241, sha256: '10a9ae521c33834fc53e43cf5d476247203dd3dbea074aaae4d2165523632042',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library-full/lib-5.tgz' },
  { name: 'cortico-world-shenshen-lib-6', version: '2.0.0', modules: 6, bytes: 72599112, sha256: 'b43ef6ddead2552d647d1f15e46f8e347e60014b7dea038d202181a0387e55d7',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library-full/lib-6.tgz' },
  { name: 'cortico-world-shenshen-lib-7', version: '2.0.0', modules: 6, bytes: 71557863, sha256: '6b4e37415519a6936fb2785ea5bdd85327542be89a829cacefd5d90b820eb2ba',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library-full/lib-7.tgz' },
  { name: 'cortico-world-shenshen-lib-8', version: '2.0.0', modules: 7, bytes: 77076542, sha256: '2375e94f9c4c6eb91798326cadea466baad8ac52506906a9042cfc42a2dffe58',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/library-full/lib-8.tgz' },
  { name: 'cortico-world-shenshen-lib-9', version: '2.0.0', modules: 7, bytes: 79853696, sha256: '9c483789c5d4c1b7c53832de616557580dbb808d23769aa595f9f2407e189628',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions-full/releases/download/library-full/lib-9.tgz' },
  { name: 'cortico-world-shenshen-lib-10', version: '2.0.0', modules: 7, bytes: 79426059, sha256: '4f22ea8fc7004f913048a98bfc48855b783c52c241053875e115092010edfb4b',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions-full/releases/download/library-full/lib-10.tgz' },
  { name: 'cortico-world-shenshen-lib-11', version: '2.0.0', modules: 7, bytes: 78710645, sha256: '11d2ea583297421ae151c26a43903d8e38d4e62a566c23cf8d9ef4a2fc544a31',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions-full/releases/download/library-full/lib-11.tgz' },
  { name: 'cortico-world-shenshen-lib-12', version: '2.0.0', modules: 7, bytes: 80391382, sha256: 'ad88b0b269d526a3a5a879e4cd1e3e9938a5db22ad9ece2e29172dd6ded1888b',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions-full/releases/download/library-full/lib-12.tgz' },
  { name: 'cortico-world-shenshen-lib-13', version: '2.0.0', modules: 7, bytes: 80405899, sha256: '421bcf0b6bb028909c641eb51c0c0ea8a28583c0434e59108c06f2532917a36c',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions-full/releases/download/library-full/lib-13.tgz' },
  { name: 'cortico-world-shenshen-lib-14', version: '2.0.0', modules: 7, bytes: 80133724, sha256: 'd639cdd74d7046e52eb08555a60284f4f1b72d42013cb0b6f8d0c545e4584d4b',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions-full/releases/download/library-full/lib-14.tgz' },
  { name: 'cortico-world-shenshen-lib-15', version: '2.0.0', modules: 7, bytes: 79935736, sha256: '85401f2e5dc6606e7c8618f7c27c4eadbdf262ea0d1a94c00734afc36c3eaa81',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions-full/releases/download/library-full/lib-15.tgz' },
  { name: 'cortico-world-shenshen-lib-16', version: '2.0.0', modules: 7, bytes: 80308462, sha256: 'a1ceda0aeff38cefc5bd438eae432d31a441b83b537fbea929784727e7ccf539',
    url: 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions-full/releases/download/library-full/lib-16.tgz' },
];

/** 默认档位（面板不传时用轻版，体积对用户更友好）。 */
export const DEFAULT_TIER = 'lite';

export const TIER_INFO = {
  lite: { id: 'lite', label: '轻版', bytes: 388118697, parts: 8, note: 'VP8 有损' },
  full: { id: 'full', label: '完整版', bytes: 1244015046, parts: 16, note: 'VP8L 无损' },
};

/** 取某一档的分卷清单。 */
export function partsFor(tier) {
  return tier === 'full' ? LIB_PARTS_FULL : LIB_PARTS_LITE;
}

/** 旧名字保留：历史代码直接引用 LIB_PARTS 时等价于轻版。 */
export const LIB_PARTS = LIB_PARTS_LITE;

/** 每片的候选地址：Gitee 优先，官方 npm 兜底（npm 分片可能会被撤，404 会立刻跳过）。 */
/**
 * 每一片只给 Gitee 一个地址。
 *
 * 早先为了"国内快"还把分片顺手发到 npm 当备用源，结果 `cortico-world-shenshen-lib-*`
 * 包一直被人从 npm 拉（面板里看不出区别）。现在动作库只认 Gitee：
 * 这些 npm 包已废弃，取源里不再出现 registry.npmjs.org。
 */
export const partTarballs = (p) => [p.url].filter(Boolean);

const MAX_LIBRARY_BYTES = 800 * 1024 * 1024;     // 完整库上限
const MAX_ACTION_BYTES = 32 * 1024 * 1024;       // 单个动作上限
/** 没配 remoteBase 时的兜底：GitHub Release 上的完整库（国内可能慢，但不至于完全没有）。 */
/** 单段动作的兜底地址：GitHub Release 上的扁平资产 `<id>.zip`（Gitee 建好后用 remoteActionBase 覆盖）。 */
export const FALLBACK_ACTION_BASE = 'https://github.com/MOYU-AI-Lab/cortico-world-extra-actions/releases/download/per-action';

export const FALLBACK_LIBRARY = 'https://github.com/MOYU-AI-Lab/cortico-world-extra-actions/releases/download/library/shenshen-action-library.zip';
/** 「更新走/跑动画」修复包：Gitee release（tag `fix`）上的 4 个文件，有损/无损两套。 */
export const FIX_BASE = 'https://gitee.com/Daniele-WOLF-Holo/shenshen-actions/releases/download/fix';
/** sha256 写死：对不上就不装（用户上传的必须是这 4 个文件本身）。 */
export const FIX_FILES = {
  walk: {
    lossy: { file: 'walk-fix-lossy.webp', bytes: 3690050, sha256: 'c325877ee74e9f3e87388e875afa1b344c75b483af6dbd77760da2ec3393c0dc' },
    lossless: { file: 'walk-fix-lossless.webp', bytes: 11151228, sha256: '4ddef63ab8b46d2981ffa8094c4d7a26cf9cf195664b55f11a3a46f65c023d23' },
  },
  crab: {
    lossy: { file: 'crab-fix-lossy.webp', bytes: 3575028, sha256: '4282b19bf37d59ccde5973b7bb9bb7602ab1e7f475569d996f672c66c13722db' },
    lossless: { file: 'crab-fix-lossless.webp', bytes: 11062262, sha256: 'e360c5fcbec0b50f3624f3eb5bdb2aa4456bf6b0e999dc1a3b61f2c866de2daa' },
  },
};
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

const FETCH_TIMEOUT_MS = 10 * 60 * 1000;     // 单片最长 10 分钟（完整版单卷 77 MB）

async function fetchBytes(url, cap) {
  if (!isHttp(url)) throw new Error(`只支持 http(s) 地址：${url}`);
  let r;
  try {
    r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    const why = e?.name === 'TimeoutError' ? '超时（5 分钟没下完）' : (e?.cause?.code ?? e?.message ?? '网络错误');
    throw new Error(`连不上：${why}`);
  }
  if (!r.ok) throw new Error(`下载失败：HTTP ${r.status}`);
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len && len > cap) throw new Error(`文件太大（${(len / 1048576).toFixed(0)} MB）：${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > cap) throw new Error(`文件太大（${(buf.length / 1048576).toFixed(0)} MB）`);
  return buf;
}

/**
 * 下载「修复包」里的一段（walk/crab × 有损/无损），校验大小、sha256 与 WebP 头。
 * 只给面板的「更新走/跑动画」按钮用；不需要登录，和动作库下载同一条网络路径。
 */
export async function downloadFix(kind, variant) {
  const spec = FIX_FILES[kind]?.[variant];
  if (!spec) throw new Error(`没有这个修复包：${kind}/${variant}`);
  const buf = await fetchBytes(`${FIX_BASE}/${spec.file}`, MAX_ACTION_BYTES);
  if (buf.length !== spec.bytes) throw new Error(`修复包大小不对（${buf.length} ≠ ${spec.bytes}）：先别继续装，联系维护者核对`);
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== spec.sha256) throw new Error(`修复包校验不通过（sha256）：${spec.file} 被改过或不是这个版本`);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') throw new Error('修复包不是 WebP 文件');
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
 *
 * 先解到同父目录下的临时目录、检查通过再换上去：以前是「先 rmSync 旧目录再解压」，
 * 遇到坏 ZIP / 缺 action.json 时旧的那段已经删了，只能重新下一遍。
 */
export async function installAction({ url, libraryDir, category, id, log }) {
  if (!libraryDir || !isAbsolute(libraryDir) || !existsSync(libraryDir)) throw new Error('动作库还没设置好');
  if (!/^[a-z][a-z0-9-]{0,15}$/.test(String(category ?? ''))) throw new Error('分类不合法');
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(String(id ?? ''))) throw new Error('id 不合法');

  const dest = join(libraryDir, 'actions', category, id);
  const root = normalize(join(libraryDir, 'actions') + sep);
  if (!normalize(dest + sep).startsWith(root)) throw new Error('落点越界');

  const buf = await fetchBytes(url, MAX_ACTION_BYTES);
  const parent = join(libraryDir, 'actions', category);
  mkdirSync(parent, { recursive: true });
  // 临时目录以 `.` 开头：库里所有扫描都跳过点目录，装到一半不会被当成一段动作。
  const stage = mkdtempSync(join(parent, `.${id}-incoming-`));
  const backup = `${stage}-previous`;
  let movedOld = false;
  try {
    const r = extractZip(buf, { dest: stage, onFile: (rel) => !rel.includes('/') && /^(action\.json|anim\.webp|preview\.webp|f_\d{4}\.webp)$/.test(rel) });
    const metaFile = join(stage, 'action.json');
    if (!existsSync(metaFile)) throw new Error('这个 zip 里没有 action.json');
    let meta;
    try {
      meta = JSON.parse(readFileSync(metaFile, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('这个 zip 里的 action.json 不是有效的 JSON');
    }
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('这个 zip 里的 action.json 不是动作对象');
    if ((meta.id && meta.id !== id) || (meta.category && meta.category !== category)) throw new Error('action.json 里的 id 或分类和请求的不一致');
    if (!r.files.some((name) => name === 'anim.webp' || /^f_\d{4}\.webp$/.test(name))) throw new Error('这个 zip 里没有动画文件');

    if (existsSync(dest)) { renameSync(dest, backup); movedOld = true; }
    try {
      renameSync(stage, dest);
    } catch (err) {
      if (movedOld) {
        try { renameSync(backup, dest); movedOld = false; }
        catch (restoreErr) { throw new Error(`替换失败，旧动作保留在 ${backup}：${restoreErr.message}`, { cause: err }); }
      }
      throw err;
    }
    if (movedOld) {
      try { rmSync(backup, { recursive: true, force: true }); }
      catch (err) { log?.(`新动作已装好，旧的暂留在 ${backup}：${err.message}`); }
    }
    log?.(`单个动作已装：${category}/${id}（${r.files.length} 个文件）`);
    return { ok: true, path: dest, files: r.files.length, bytes: buf.length };
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
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
  const totalBytes = parts.reduce((sum, p) => sum + (p.bytes || 0), 0);
  let bytes = 0;
  let failed = 0;
  const errors = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    let buf = null;
    let lastErr = null;
    for (const url of partTarballs(p)) {
      try { buf = await fetchBytes(url, MAX_LIBRARY_BYTES); break; } catch (e) { lastErr = e; }
    }
    if (!buf) {
      failed++;
      errors.push(`第 ${i + 1} 片：${lastErr?.message ?? '未知错误'}`);
      log?.(`第 ${i + 1} 片下载失败：${lastErr?.message ?? '未知错误'}`);
      continue;
    }
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
    onProgress?.({ done: i + 1, total: parts.length, bytes, totalBytes });
  }
  const mods = summarize(dest);
  const added = mods.filter((m) => !before.has(m));
  return { ok: failed === 0, path: dest, modules: mods.length, added: added.length, failed, bytes, totalBytes, errors };
}
