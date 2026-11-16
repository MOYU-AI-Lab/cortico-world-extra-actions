/**
 * 形象包体检：查「某个动作为什么点不出名字」这类问题。
 *   node doctor.mjs <形象包目录>
 *
 * 检查四件事，任何一条对不上，bot 就调用不出那个词：
 *   1. 额外动作拓展/ 下的模块是否存在、action.json 是否可读
 *   2. 模块里的 word 与 额外动作拓展/index.js 里登记的是否一致
 *   3. figure.json 的 vocab 里是否有这个词（bot 只认 vocab）
 *   4. 模块的素材是否齐（anim.webp 或 f_0001.webp…）
 * 另外把「库里没有、只是清单里有」的词单独列出来（那种必然调用不出来）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const pack = resolve(process.argv[2] ?? '');
if (!pack || !existsSync(join(pack, 'figure.json'))) {
  console.error('用法: node doctor.mjs <形象包目录>');
  process.exit(2);
}

const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return d; } };
const fig = readJson(join(pack, 'figure.json')) ?? {};
const extrasRoot = join(pack, '额外动作拓展');

/* 1. 模块清单 */
const modules = new Map();   // id -> { cat, dir, json }
if (existsSync(extrasRoot)) {
  for (const cat of readdirSync(extrasRoot, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    for (const m of readdirSync(join(extrasRoot, cat.name), { withFileTypes: true })) {
      if (!m.isDirectory()) continue;
      const dir = join(extrasRoot, cat.name, m.name);
      const json = readJson(join(dir, 'action.json'));
      modules.set(m.name, { cat: cat.name, dir, json });
    }
  }
}

/* 2. index.js 里登记的词 */
// 直接 import 这个 ES module（它是真 JS，可能带尾逗号，JSON.parse 会失败）
let indexEntries = [];
const indexFile = join(extrasRoot, 'index.js');
if (existsSync(indexFile)) {
  try {
    const mod = await import('file:///' + indexFile.replace(/\\/g, '/') + '?v=' + Math.random());
    if (Array.isArray(mod?.default)) indexEntries = mod.default;
  } catch (e) {
    console.log('⚠️ 额外动作拓展/index.js 语法有问题，桌宠会读不了：' + String(e?.message ?? e));
  }
}
const indexByClip = new Map(indexEntries.map((e) => [e.clip, e]));

/* 3. vocab（bot 真正认识的词） */
const vocab = Array.isArray(fig.vocab) ? fig.vocab : [];
const vocabIds = new Set(vocab.map((w) => w?.id).filter(Boolean));

const problems = [];
const notes = [];

for (const [id, { cat, dir, json }] of modules) {
  const clip = `额外动作拓展/${cat}/${id}`;
  if (!json) { problems.push(`${id}：action.json 读不出来`); continue; }
  const word = json.word ?? null;
  if (!word) { notes.push(`${id}：没有 word（当成状态段，不参与点名）`); continue; }

  const entry = indexByClip.get(clip);
  if (!entry) problems.push(`${id}：模块在，但 额外动作拓展/index.js 里没有它 → 桌宠看不见`);
  else if (entry.word !== word) problems.push(`${id}：index 登记的词是 ${entry.word}，模块里写的是 ${word} → 对不上`);

  if (!vocabIds.has(word)) problems.push(`${id}（${json.zh ?? ''}）：figure.json 的 vocab 里没有 "${word}" → bot 认不出这个词`);

  const hasAnim = existsSync(join(dir, 'anim.webp'));
  const frames = readdirSync(dir).filter((n) => /^f_\d{4}\.webp$/.test(n)).length;
  if (!hasAnim && frames === 0) problems.push(`${id}：素材一个都没有（既没 anim.webp 也没 f_*.webp）`);
  else if (!hasAnim && json.frames && frames !== json.frames) problems.push(`${id}：帧数 ${frames}/${json.frames}`);
}

/* 3.5 vocab 本身会不会被宿主拒（一票否决：一条坏名字 → 整份词表作废） */
{
  const NAME_BREAK = /[,，、\s【】<>＜＞]/;
  const taken = new Set();
  for (const w of vocab) {
    const id = String(w?.id ?? '');
    const bad = (why) => problems.push(`vocab "${id}"：${why} → 宿主会拒掉**整份词表**，bot 一个动作都点不出来`);
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) { bad('id 不合法'); continue; }
    for (const list of Object.values(w?.names ?? {})) {
      for (const n of Array.isArray(list) ? list : []) {
        if (typeof n !== 'string' || !n.trim() || n.length > 32 || NAME_BREAK.test(n)) bad(`名字 ${JSON.stringify(n)} 含禁字符或超 32 字`);
      }
    }
    for (const n of [id, ...Object.values(w?.names ?? {}).flat()]) {
      if (taken.has(n)) bad(`名字重复：${n}`);
      taken.add(n);
    }
    const about = w?.about;
    if (!about || typeof about !== 'object' || !Object.values(about).some((v) => typeof v === 'string' && v.trim())) bad('缺 about');
    if (typeof w?.seconds !== 'number' || !(w.seconds > 0)) bad('seconds 不合法');
  }
}

/* 4. vocab 里有、但包里没有的词（通常是删了模块没重存） */
for (const w of vocabIds) {
  if (w.startsWith?.('state-')) continue;
  const hit = [...modules.values()].some((m) => (m.json?.word ?? null) === w);
  if (!hit) problems.push(`"${w}"：vocab 里有，但包里没有这个模块 → bot 会点名一段不存在的动作`);
}

/* 输出 */
console.log(`形象包：${pack}`);
console.log(`额外动作模块：${modules.size} 个 | index 条目：${indexEntries.length} 条 | vocab：${vocab.length} 条`);
console.log('');
if (notes.length) {
  console.log('— 说明（不算错）');
  for (const n of notes) console.log('  · ' + n);
  console.log('');
}
if (!problems.length) {
  console.log('✅ 没发现问题：每个模块都在 index 和 vocab 里，素材也齐。');
} else {
  console.log(`❌ 发现 ${problems.length} 个问题：`);
  for (const p of problems) console.log('  · ' + p);
  console.log('');
  console.log('修法：在扩展面板里把这段重新勾上 → 点「保存随机列表」→ 完全退出 Coopanion 再打开 → 装扮页重新点一下形象。');
}
process.exit(problems.length ? 1 : 0);
