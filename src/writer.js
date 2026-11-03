/**
 * 额外动作拓展 —— 把勾选的动作写进一个形象包的 `额外动作拓展/` 文件夹。
 *
 * 这个文件是纯逻辑（只依赖 node:fs / node:path），面板、命令行、测试都用它，
 * 所以"插件里点保存"和"命令行跑一遍"写出来的东西一定一模一样。
 *
 * 写出来的东西长这样（<pack>/额外动作拓展/）：
 *   额外动作拓展/
 *     index.js        桌宠 import 的清单（export default [...{word, clip, frames, seconds, name}]）
 *     index.json      同一份内容，给工具和人看
 *     README.md       这一份是怎么来的
 *     .managed.json   插件管过哪些动作、加过哪些词（用于"取消勾选"和恢复 figure.json）
 *     <分类>/<id>/    anim.webp（640×360，一段一个文件）+ action.json
 *                     老格式 f_0001.webp … + preview.webp 也认
 *
 * 同时会改 <pack>/figure.json 的 vocab：勾中的进、没勾的动作词出，第一次动之前留一份
 * figure.json.bak-额外动作拓展。
 *
 * 安全约束（这里是唯一碰磁盘的地方，所以全部收紧）：
 *   - 只写 <pack>/额外动作拓展/ 里的东西，写入前校验路径确实在那个包里面；
 *   - 拷帧只认清单里的 frames 张 f_NNNN.webp，符号链接、非常规文件、超长超大的文件一律拒绝，
 *     且只拷这些、不做整目录递归拷贝 —— 库目录里塞什么都不会被带进包；
 *   - 生成给桌宠 import 的 index.js 时，所有字符串都走 JSON.stringify，id/分类/路径先过白名单正则；
 *   - figure.json 只动 vocab 一个字段。
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const EXTRA_DIR = '额外动作拓展';
export const MANAGED_FILE = '.managed.json';
export const VOCAB_BACKUP = 'figure.json.bak-额外动作拓展';
const SCHEMA = 1;

/** 一次最多勾多少个（面板不会给这么多，但 invoke 的参数不可信）。 */
const MAX_SELECTION = 300;
/** 一张帧、一个模块的字节上限：正常一张 640×360 无损 webp 约 55 KB，一模块约 13 MB。 */
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_MODULE_BYTES = 64 * 1024 * 1024;
/** 动作模块名、分类名：和 packs.ts 的 ID 规则同一套，纯 ASCII，不含路径分隔符。 */
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SAFE_CAT = /^[a-z][a-z0-9-]{0,15}$/;

const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
};

const readText = (file) => {
  try {
    return readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
};

const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
};

const writeText = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
};

/** `child` 是否真的在 `root` 里面（挡住 `..`、绝对路径和别的盘符）。 */
export function isInside(root, child) {
  const rel = relative(resolve(root), resolve(child));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** 名字里去掉控制字符与行分隔符，并截到 32 字（气泡里的 inline 标记上限）。 */
export function cleanLabel(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '')
    .trim()
    .slice(0, 32);
}

/**
 * 一条目录清单能不能信：id/分类/路径/帧数/时长都在白名单规则内。
 * 返回 null 表示通过，否则是不通过的原因。
 */
export function actionProblem(a) {
  if (!a || typeof a !== 'object') return '不是对象';
  if (!SAFE_ID.test(String(a.id ?? ''))) return `id 不合法：${JSON.stringify(a.id)}`;
  if (!SAFE_ID.test(String(a.word ?? ''))) return `触发词不合法：${JSON.stringify(a.word)}`;
  if (!SAFE_CAT.test(String(a.category ?? ''))) return `分类不合法：${JSON.stringify(a.category)}`;
  if (a.clip !== `actions/${a.category}/${a.id}`) return `路径和 id 对不上：${JSON.stringify(a.clip)}`;
  if (!Number.isInteger(a.frames) || a.frames < 1 || a.frames > 1000) return `帧数不合法：${a.frames}`;
  if (typeof a.seconds !== 'number' || !Number.isFinite(a.seconds) || a.seconds <= 0 || a.seconds > 60) return `时长不合法：${a.seconds}`;
  if (!cleanLabel(a.zh || a.say)) return '没有名字';
  return null;
}

/** 一个目录里 f_0001.webp 这样的帧有多少张。 */
const countFrames = (dir) => {
  try {
    return readdirSync(dir).filter((n) => /^f_\d{4}\.webp$/.test(n)).length;
  } catch {
    return 0;
  }
};

/** 目录总字节数。 */
export function dirBytes(dir) {
  let sum = 0;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) sum += dirBytes(full);
      else if (e.isFile()) sum += statSync(full).size;
    }
  } catch {
    /* 不存在就是 0 */
  }
  return sum;
}

/** 这个形象包是不是"能加动作"的那种：入口得是会读 `额外动作拓展/` 的播放器。 */
export function packLooksSupported(packDir) {
  if (!existsSync(join(packDir, 'figure.json'))) return false;
  const fig = readJson(join(packDir, 'figure.json'));
  if (!fig || fig.manifest !== 2) return false;
  const entry = fig.entry ? join(packDir, String(fig.entry)) : null;
  if (!entry || !existsSync(entry)) return false;
  // 入口文件正常情况下几十 KB；大到不像脚本就不读（别被一个畸形包拖住）
  const st = lstatSync(entry, { throwIfNoEntry: false });
  if (!st || !st.isFile() || st.size > 2 * 1024 * 1024) return false;
  const js = readText(entry) ?? '';
  // 只认真正会去读这个文件夹的播放器：动作库那个（actions/index.js + 额外动作拓展/index.js）。
  // 早先那个只认 ext/clips.js 的补丁不认，别的角色（horo、clawd…）也不认。
  return /额外动作拓展|actions\/index\.js|actions\/index['"]/.test(js);
}

/** 当前这个包里已经装了哪些额外动作。 */
export function readExtra(packDir) {
  const root = join(packDir, EXTRA_DIR);
  const managed = readJson(join(root, MANAGED_FILE));
  const byDisk = [];
  try {
    for (const cat of readdirSync(root, { withFileTypes: true })) {
      if (!cat.isDirectory()) continue;
      for (const mod of readdirSync(join(root, cat.name), { withFileTypes: true })) {
        if (mod.isDirectory()) byDisk.push(`${cat.name}/${mod.name}`);
      }
    }
  } catch {
    /* 还没装过 */
  }
  const ids = Array.isArray(managed?.ids) ? managed.ids : [];
  const folders = byDisk.filter((p) => !p.startsWith('.'));
  return {
    present: existsSync(root),
    root,
    ids,
    folders,
    bytes: dirBytes(root),
    updatedAt: typeof managed?.updatedAt === 'string' ? managed.updatedAt : null,
    // 新写入只存库名；老包里存的是绝对路径，这里统一折成名字，别把本机路径再往外传
    libraryName: typeof managed?.libraryName === 'string'
      ? managed.libraryName
      : (typeof managed?.library === 'string' && managed.library ? basename(managed.library) : null),
    packId: typeof managed?.packId === 'string' ? managed.packId : null,
  };
}

/** 按动作库条目造一条 vocab。 */
export function vocabEntry(action) {
  const name = action.say || action.zh;
  return {
    id: action.word,
    kind: 'motion',
    names: { zh: [name] },
    about: { zh: `${action.catZh || action.category}：${action.zh}` },
    seconds: action.seconds,
  };
}

/** 上一次写下去的 vocab id 序列，和现在一样就说明没人改过，可以干净地回到 base。 */
const sameIds = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * 写 figure.json 的动作词。
 *
 * 语义是"勾选即全部"：勾中的就是桌宠会做的动作，没勾的动作词从清单里拿掉。
 * 表情、以及非 motion 的条目一个字都不动。第一次改之前留 figure.json.bak-额外动作拓展，
 * 并把原始 vocab 记在 .managed.json 里 —— 「清空拓展」会把原文还回去。
 */
function applyVocab(packDir, actions, managed) {
  const file = join(packDir, 'figure.json');
  const fig = readJson(file);
  if (!fig) throw new Error('figure.json 读不动，词表没法更新');
  const backup = join(packDir, VOCAB_BACKUP);
  if (!existsSync(backup)) writeText(backup, readFileSync(file, 'utf8'));

  const current = Array.isArray(fig.vocab) ? fig.vocab : [];
  const clean = managed?.written && sameIds(current.map((w) => w?.id), managed.written);
  const base = (clean && Array.isArray(managed.baseVocab)) ? managed.baseVocab : current;

  const wanted = new Set(actions.map((a) => a.word).filter(Boolean));
  const kept = base.filter((w) => w?.kind !== 'motion' || wanted.has(w?.id));
  const have = new Set(kept.map((w) => w?.id));
  const added = [];
  for (const a of actions) {
    if (!a.word || have.has(a.word)) continue;
    kept.push(vocabEntry(a));
    have.add(a.word);
    added.push(a.word);
  }
  const removed = current.filter((w) => !have.has(w?.id)).map((w) => w?.id);
  fig.vocab = kept;
  writeJson(file, fig);
  return { added, removed, baseVocab: base, written: kept.map((w) => w?.id) };
}

/** 清空时把词表还回去：先回到 base，实在对不上就只摘掉自己加的那些。 */
function restoreVocab(packDir, managed) {
  const file = join(packDir, 'figure.json');
  const fig = readJson(file);
  if (!fig) return { added: [], removed: [] };
  const current = Array.isArray(fig.vocab) ? fig.vocab : [];
  const clean = managed?.written && sameIds(current.map((w) => w?.id), managed.written);
  let restored = false;
  if (clean && Array.isArray(managed.baseVocab)) {
    fig.vocab = managed.baseVocab;
    restored = true;
  } else {
    const drop = new Set(Array.isArray(managed?.added) ? managed.added : []);
    fig.vocab = current.filter((w) => !drop.has(w?.id));
  }
  writeJson(file, fig);
  return { added: [], removed: [], restored };
}

/** 形象包目录的硬性检查：有 figure.json，且 额外动作拓展 确实是它下面的子目录。 */
function assertPack(packDir) {
  if (typeof packDir !== 'string' || !packDir.trim()) throw new Error('没有形象包目录');
  if (typeof packDir !== 'string' || !isAbsolute(packDir)) throw new Error(`形象包目录要是绝对路径：${packDir}`);
  if (!existsSync(join(packDir, 'figure.json'))) throw new Error(`不是形象包目录：${packDir}`);
  const root = join(packDir, EXTRA_DIR);
  if (!isInside(packDir, root)) throw new Error('形象包目录不合法');
  return root;
}

/**
 * 拷一条动作模块：只认清单里那 frames 张帧 + preview.webp。
 * 不做整目录递归拷贝 —— 库目录里多放什么都不会进包；符号链接、非常规文件、超大文件一律拒绝。
 * action.json 不复制，按校验过的字段重写一份。
 */
function copyModule(libraryDir, action, packDir) {
  const srcDir = join(libraryDir, 'actions', action.category, action.id);
  if (!isInside(libraryDir, srcDir)) throw new Error(`库里的路径越界：${action.clip}`);
  const dstDir = join(packDir, EXTRA_DIR, action.category, action.id);
  if (!isInside(packDir, dstDir)) throw new Error(`包里的路径越界：${action.clip}`);

  /* ---- 单文件动画模块（640×360 的 anim.webp）：高清库就是这种格式 ----
     一个文件顶整段，浏览器自己循环播放；不做拆帧，体积只有帧序列的 1/4~1/6。 */
  const animSrc = join(srcDir, 'anim.webp');
  const ast = lstatSync(animSrc, { throwIfNoEntry: false });
  const isSingle = action.anim === true || (!!ast && ast.isFile());
  if (isSingle) {
    if (!ast) throw new Error(`库里缺 ${action.id}/anim.webp`);
    if (ast.isSymbolicLink()) throw new Error(`${action.id}/anim.webp 是符号链接，拒绝拷进形象包`);
    if (!ast.isFile()) throw new Error(`${action.id}/anim.webp 不是普通文件`);
    if (ast.size <= 0 || ast.size > MAX_MODULE_BYTES) throw new Error(`${action.id}/anim.webp 大小异常（${ast.size} 字节）`);

    const dstAnim = join(dstDir, 'anim.webp');
    const dstSt = lstatSync(dstAnim, { throwIfNoEntry: false });
    if (dstSt && dstSt.isFile() && dstSt.size === ast.size) {
      return { id: action.id, copied: false, bytes: dirBytes(dstDir) };
    }
    rmSync(dstDir, { recursive: true, force: true });
    mkdirSync(dstDir, { recursive: true });
    copyFileSync(animSrc, dstAnim);
    const preview = join(srcDir, 'preview.webp');
    const pst = lstatSync(preview, { throwIfNoEntry: false });
    if (pst && pst.isFile() && pst.size > 0 && pst.size <= MAX_FRAME_BYTES) copyFileSync(preview, join(dstDir, 'preview.webp'));
    writeJson(join(dstDir, 'action.json'), {
      id: action.id,
      zh: cleanLabel(action.zh),
      say: cleanLabel(action.say || action.zh),
      category: action.category,
      clip: `${EXTRA_DIR}/${action.category}/${action.id}`,
      frames: action.frames,
      fps: action.fps || 24,
      seconds: action.seconds,
      word: action.word,
      roles: [],
      noMirror: !!action.noMirror,
      reaction: !!action.reaction,
      random: action.random !== false,
      anim: true,
    });
    return { id: action.id, copied: true, bytes: dirBytes(dstDir) };
  }

  const frames = Array.from({ length: action.frames }, (_, i) => `f_${String(i + 1).padStart(4, '0')}.webp`);
  let total = 0;
  for (const name of frames) {
    const file = join(srcDir, name);
    const st = lstatSync(file, { throwIfNoEntry: false });
    if (!st) throw new Error(`库里缺 ${action.id}/${name}`);
    if (st.isSymbolicLink()) throw new Error(`${action.id}/${name} 是符号链接，拒绝拷进形象包`);
    if (!st.isFile()) throw new Error(`${action.id}/${name} 不是普通文件`);
    if (st.size <= 0 || st.size > MAX_FRAME_BYTES) throw new Error(`${action.id}/${name} 大小异常（${st.size} 字节）`);
    total += st.size;
  }
  if (total > MAX_MODULE_BYTES) throw new Error(`${action.id} 超过 ${MAX_MODULE_BYTES / 1024 / 1024} MB`);

  const preview = join(srcDir, 'preview.webp');
  const pst = lstatSync(preview, { throwIfNoEntry: false });
  const copyPreview = !!pst && pst.isFile() && pst.size > 0 && pst.size <= MAX_FRAME_BYTES;

  if (countFrames(dstDir) === action.frames) return { id: action.id, copied: false, bytes: dirBytes(dstDir) };

  rmSync(dstDir, { recursive: true, force: true });
  mkdirSync(dstDir, { recursive: true });
  for (const name of frames) copyFileSync(join(srcDir, name), join(dstDir, name));
  if (copyPreview) copyFileSync(preview, join(dstDir, 'preview.webp'));
  writeJson(join(dstDir, 'action.json'), {
    id: action.id,
    zh: cleanLabel(action.zh),
    say: cleanLabel(action.say || action.zh),
    category: action.category,
    clip: `${EXTRA_DIR}/${action.category}/${action.id}`,
    frames: action.frames,
    fps: action.fps || 24,
    seconds: action.seconds,
    word: action.word,
    roles: [],
    noMirror: !!action.noMirror,
    reaction: !!action.reaction,
    random: action.random !== false,
  });
  return { id: action.id, copied: true, bytes: dirBytes(dstDir) };
}

/** 生成桌宠读的那份清单。所有字符串走 JSON.stringify，不会漏出可执行片段。 */
function renderIndexJs(entries) {
  const lines = [
    '/**',
    ` * ${EXTRA_DIR} —— 由 Coopanion 扩展「额外动作拓展」写入，别手改（下次保存会覆盖）。`,
    ' * 桌宠的播放器 import 这个文件，把它并进自己的动作表：',
    ' *   额外动作拓展/index.js → [...actions/index.js, ...这里]',
    ' * 每项：word 触发词 / clip 目录（相对包根）/ frames 帧数 / seconds 时长 / name 中文名。',
    ' */',
    'export default [',
  ];
  for (const e of entries) {
    const parts = [
      `word: ${JSON.stringify(e.word)}`,
      `clip: ${JSON.stringify(e.clip)}`,
      `frames: ${Number(e.frames)}`,
      `fps: ${Number(e.fps)}`,
      `seconds: ${Number(e.seconds)}`,
      `name: ${JSON.stringify(cleanLabel(e.name))}`,
      `category: ${JSON.stringify(e.category)}`,
      `anim: ${e.anim ? 'true' : 'false'}`,
      `noMirror: ${e.noMirror ? 'true' : 'false'}`,
      `reaction: ${e.reaction ? 'true' : 'false'}`,
      `random: ${e.random ? 'true' : 'false'}`,
    ];
    lines.push(`  { ${parts.join(', ')} },`);
  }
  lines.push('];');
  return lines.join('\n') + '\n';
}

function renderReadme({ packName, packId, actions, libraryDir, updatedAt }) {
  const rows = actions
    .map((a) => `| \`${a.word}\` | ${a.zh} | ${a.category} | ${a.frames} | ${a.seconds.toFixed(2)}s |`)
    .join('\n');
  // 只写库的名字，不写路径：这个文件夹会跟着角色包一起被分享，写死绝对路径对别人既没用又暴露本机目录。
  const libName = libraryDir ? basename(libraryDir) : '（未设置）';
  return `# ${EXTRA_DIR}

这个文件夹由 **Coopanion 扩展「额外动作拓展」** 写入，桌宠会把它并进自己的动作表。

- 形象包：${packName || packId}（\`${packId}\`）
- 动作素材来自：动作库「${libName}」
- 更新时间：${updatedAt}
- 已选动作：${actions.length} 段

## 桌宠怎么读

\`index.js\` 默认导出一个数组，每一项是：

\`\`\`js
{ word, clip, frames, fps, seconds, name, category, anim, noMirror, reaction, random }
\`\`\`

\`clip\` 是相对包根的目录（例如 \`额外动作拓展/eat/eat-dumplings\`）。里面装的是整段动图
\`anim.webp\`（640×360，一段一个文件，清单里带 \`anim: true\`）；老格式的帧序列
\`f_0001.webp\` … 也照样认。播放器把这些和 \`actions/index.js\` 里的动作合并；
\`word\` 不为空的动作会被登记进词表（重启 Coopanion 后 bot 才能点名）。

## 已选

| 触发词 | 名称 | 分类 | 帧 | 时长 |
|---|---|---|---|---|
${rows}

## 想改

回到 Coopanion 的「额外动作拓展」面板重新勾选即可：取消的会被删掉，
\`figure.json\` 里对应的词也会一并撤掉（改动前的原文在 \`figure.json.bak-额外动作拓展\`）。
动作库在哪台机器上由各自的面板自己指定，这份清单里不存路径。
`;
}

/**
 * 保存一份勾选结果。
 *
 * @param {object} o
 * @param {string} o.packDir    形象包目录（里面就是 figure.json）
 * @param {string[]} o.ids      勾选的模块 id
 * @param {object[]} o.catalog  动作库清单（条目里有 clip/frames/seconds/word/...）
 * @param {string} o.libraryDir 动作库目录（帧从这里拷）
 * @param {object} [o.pack]     形象包信息 { id, name }
 * @returns {{copied:string[], skipped:string[], removed:string[], bytes:number, vocab:object, updatedAt:string}}
 */
export function save({ packDir, ids, catalog, libraryDir, pack = {} }) {
  const root = assertPack(packDir);
  if (typeof libraryDir !== 'string' || !isAbsolute(libraryDir)) throw new Error(`动作库目录要是绝对路径：${libraryDir}`);
  if (!Array.isArray(ids)) throw new Error('ids 必须是数组');
  if (ids.length > MAX_SELECTION) throw new Error(`一次最多 ${MAX_SELECTION} 个动作`);

  const byId = new Map(catalog.map((a) => [a.id, a]));
  const chosen = [];
  for (const id of ids) {
    const a = byId.get(String(id));
    if (!a || !a.word) continue;
    const bad = actionProblem(a);
    if (bad) throw new Error(`清单里的动作「${String(id)}」不可用：${bad}`);
    chosen.push(a);
  }
  if (!chosen.length) throw new Error('没有勾选任何可点名的动作（状态类动作不需要放进拓展）');

  const before = readExtra(packDir);
  mkdirSync(root, { recursive: true });

  // 1. 取消勾选的：删目录（只删 EXTRA_DIR 下面、名字在白名单里的那些）
  const keep = new Set(chosen.map((a) => a.id));
  const dropped = [];
  for (const rel of before.folders) {
    const [cat, id] = rel.split('/');
    if (!SAFE_CAT.test(cat ?? '') || !SAFE_ID.test(id ?? '')) continue;
    if (keep.has(id)) continue;
    const target = join(root, cat, id);
    if (!isInside(root, target)) continue;
    rmSync(target, { recursive: true, force: true });
    dropped.push(id);
  }

  // 2. 勾选的：拷模块
  const copied = [];
  const skipped = [];
  for (const a of chosen) {
    const r = copyModule(libraryDir, a, packDir);
    (r.copied ? copied : skipped).push(a.id);
  }

  // 3. 清单 + 说明
  const updatedAt = new Date().toISOString();
  const entries = chosen.map((a) => ({
    word: a.word,
    clip: `${EXTRA_DIR}/${a.category}/${a.id}`,
    frames: a.frames,
    fps: a.fps ?? 24,
    seconds: a.seconds,
    name: a.zh,
    category: a.category,
    anim: a.anim === true,          // 单文件动画模块：播放器直接挂 anim.webp
    noMirror: !!a.noMirror,
    reaction: !!a.reaction,
    random: a.random !== false,
  }));
  writeText(join(root, 'index.js'), renderIndexJs(entries));
  writeJson(join(root, 'index.json'), {
    schema: SCHEMA,
    pack: pack.id ?? before.packId ?? null,
    libraryName: basename(libraryDir),
    updatedAt,
    count: entries.length,
    actions: entries,
  });
  writeText(join(root, 'README.md'), renderReadme({
    packName: pack.name, packId: pack.id ?? before.packId ?? '', actions: chosen, libraryDir, updatedAt,
  }));

  // 4. figure.json 的词表：勾中的就是全部动作词（表情等非 motion 不动）
  const managedBefore = readJson(join(root, MANAGED_FILE), null);
  const vocab = applyVocab(packDir, chosen, managedBefore);

  // 5. 记账
  const idsSaved = chosen.map((a) => a.id);
  writeJson(join(root, MANAGED_FILE), {
    schema: SCHEMA,
    packId: pack.id ?? before.packId ?? null,
    // 只记库名，不记绝对路径：.managed.json 会跟着角色包走
    libraryName: basename(libraryDir),
    updatedAt,
    ids: idsSaved,
    added: vocab.added,
    written: vocab.written,
    baseVocab: vocab.baseVocab,
  });

  return {
    copied,
    skipped,
    removed: dropped,
    bytes: dirBytes(root),
    vocab: { added: vocab.added, removed: vocab.removed },
    updatedAt,
    count: entries.length,
  };
}

/** 清空：删掉整个额外动作拓展，并把 figure.json 的词表还回勾选之前的样子。 */
export function clear(packDir, catalog, packId = null) {
  const before = readExtra(packDir);
  const root = assertPack(packDir);
  const managed = readJson(join(root, MANAGED_FILE), null);
  let vocab = { added: [], removed: [] };
  if (managed) {
    const file = join(packDir, 'figure.json');
    const fig = readJson(file);
    if (fig) {
      const backup = join(packDir, VOCAB_BACKUP);
      if (!existsSync(backup)) writeText(backup, readFileSync(file, 'utf8'));
      const back = restoreVocab(packDir, managed);
      vocab = { added: [], removed: Array.isArray(managed.added) ? managed.added : [], restored: !!back.restored };
    }
  }
  if (isInside(packDir, root)) rmSync(root, { recursive: true, force: true });
  return { removed: before.folders.length, vocab, packId: packId ?? before.packId };
}

/** 删掉单段：从现有勾选里去掉它，其余照旧；如果是最后一段就等同清空（词表还原）。 */
export function removeOne({ packDir, id, catalog, libraryDir, pack = {} }) {
  const before = readExtra(packDir);
  const ids = before.ids.length ? before.ids : before.folders.map((f) => f.split('/').pop());
  const clean = String(id ?? '');
  if (!ids.includes(clean)) throw new Error(`这个包里没有名为 ${JSON.stringify(clean)} 的动作`);
  const remaining = ids.filter((x) => x !== clean);
  if (!remaining.length) {
    const r = clear(packDir, catalog, pack.id);
    return { ...r, removed: clean, remaining: 0, cleared: true };
  }
  const r = save({ packDir, ids: remaining, catalog, libraryDir, pack });
  return { ...r, removed: clean, remaining: remaining.length, cleared: false };
}

/**
 * 瘦身：把包里「用不到」的动作模块删掉，只留真正会播的那几段。
 *
 * 会保留：
 *   - 有 roles 的模块（idle / walk / drag / turn，身体状态靠它们）；
 *   - `额外动作拓展/index.js` 里列到的模块（勾选的那些，通常在 额外动作拓展/ 下，这里只防重复）；
 * 其它 `actions/<分类>/<id>/` 一律删掉 —— 它们只在清单里挂个名字，永远不会被播。
 *
 * 之后想再启用某一段：面板里勾上并保存，writer 会从动作库重新拷进来。
 */
export function prunePack(packDir) {
  const root = assertPack(packDir);
  const actionsDir = join(packDir, 'actions');
  if (!existsSync(actionsDir)) throw new Error('这个包里没有 actions/');

  const keep = new Set();
  const removed = [];
  let freed = 0;
  for (const cat of readdirSync(actionsDir, { withFileTypes: true })) {
    if (!cat.isDirectory() || cat.name.startsWith('.')) continue;
    for (const mod of readdirSync(join(actionsDir, cat.name), { withFileTypes: true })) {
      if (!mod.isDirectory() || mod.name.startsWith('.')) continue;
      const dir = join(actionsDir, cat.name, mod.name);
      if (!isInside(actionsDir, dir)) continue;
      const meta = readJson(join(dir, 'action.json'), null);
      if (!meta) continue;                       // 没有 action.json 的不动
      const hasRole = Array.isArray(meta.roles) && meta.roles.length > 0;
      if (hasRole) { keep.add(meta.id ?? mod.name); continue; }
      const bytes = dirBytes(dir);
      rmSync(dir, { recursive: true, force: true });
      removed.push(`${cat.name}/${mod.name}`);
      freed += bytes;
    }
  }
  // 清掉空分类目录（只删空的）
  for (const cat of readdirSync(actionsDir, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    try { if (readdirSync(join(actionsDir, cat.name)).length === 0) rmSync(join(actionsDir, cat.name), { recursive: true }); } catch { /* 忽略 */ }
  }
  return { kept: [...keep], removed, freed, left: dirBytes(root) };
}

/** 体检：包目录 + 库目录能不能用。给面板在保存前提示。 */
export function inspect({ packDir, libraryDir, catalog }) {
  const problems = [];
  if (!existsSync(join(packDir, 'figure.json'))) problems.push(`包里没有 figure.json：${packDir}`);
  if (!libraryDir || !existsSync(libraryDir)) problems.push(`动作库目录不存在：${libraryDir}`);
  const missing = [];
  for (const a of catalog) {
    // 身体状态段（idle / walk / drag / turn）没有触发词，它们不是"可加的动作"
    if (!a.word) continue;
    if (actionProblem(a)) { missing.push(a.id); continue; }
    const dir = join(libraryDir || '', 'actions', a.category, a.id);
    if (!existsSync(dir)) { missing.push(a.id); continue; }
    // 单文件动画模块（anim.webp）：帧数在文件里，不能按 f_NNNN 数
    if (a.anim || existsSync(join(dir, 'anim.webp'))) continue;
    if (countFrames(dir) !== a.frames) missing.push(a.id);
  }
  const extra = readExtra(packDir);
  return {
    ok: problems.length === 0 && missing.length === 0,
    problems,
    missing,
    present: extra.present,
    ids: extra.ids,
    bytes: extra.bytes,
    updatedAt: extra.updatedAt,
    root: relative(join(packDir, '..'), extra.root).replace(/\\/g, '/'),
  };
}
