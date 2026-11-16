/**
 * 词表名字的回归测试：宿主对 vocab 的校验是「一票否决」。
 *
 * Coopanion 的 packs.ts → readVocab()：
 *   - 名字不能含 , ， 、 空白 【】 <> ＜＞（NAME_BREAK）
 *   - 名字不能超过 32 字（INLINE_TAG_MAX）
 *   - 名字（含 id）不能重复
 *   - about 必填、seconds 必须是正数
 * 任何一条不合格 → **整个 vocab 被拒**（函数返回错误字符串）→ bot 一个动作都点不出来。
 * 用户看到的现象是"某个动作调用不出来"，实际是整份词表没了。
 *
 *   node test_vocab_names.mjs
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const W = await import(pathToFileURL(join(here, '..', 'src', 'writer.js')).href);
const S = await import(pathToFileURL(join(here, '..', 'src', 'starter.js')).href);

const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(`${msg} → ${e.message}`); console.log('FAIL ' + msg); } };

/* ---------- 照着宿主 readVocab 写一遍校验 ---------- */
const NAME_BREAK = /[,，、\s【】<>＜＞]/;
const INLINE_TAG_MAX = 32;
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** 返回 null = 通过；否则是宿主会给出的错误（此时整份 vocab 作废）。 */
function hostVocabError(vocab) {
  const taken = new Set();
  for (const w of vocab) {
    if (typeof w?.id !== 'string' || !ID.test(w.id)) return `id 不合法: ${JSON.stringify(w?.id)}`;
    if (w.kind !== 'expression' && w.kind !== 'motion') return `kind 不认识: ${w.kind}`;
    for (const list of Object.values(w.names ?? {})) {
      if (!Array.isArray(list)) return 'names 不是数组';
      for (const n of list) {
        if (typeof n !== 'string' || !n.trim() || n.length > INLINE_TAG_MAX || NAME_BREAK.test(n)) {
          return `名字不合法: ${w.id} → ${JSON.stringify(n)}`;
        }
      }
    }
    for (const n of [w.id, ...Object.values(w.names ?? {}).flat()]) {
      if (taken.has(n)) return `名字重复: ${n}`;
      taken.add(n);
    }
    const about = w.about;
    const hasAbout = about && typeof about === 'object' && Object.values(about).some((v) => typeof v === 'string' && v.trim());
    if (!hasAbout) return `缺 about: ${w.id}`;
    if (typeof w.seconds !== 'number' || !(w.seconds > 0) || !Number.isFinite(w.seconds)) return `seconds 不合法: ${w.id}`;
  }
  return null;
}

/* ① 复现：带逗号的名字会让整份词表被拒 */
check(() => {
  const bad = [
    { id: 'what-to-eat', kind: 'motion', names: { zh: ['是啊，吃什么'] }, about: { zh: '碎碎念' }, seconds: 10 },
    { id: 'eat-dumplings', kind: 'motion', names: { zh: ['吃饺子'] }, about: { zh: '吃喝' }, seconds: 10 },
  ];
  const err = hostVocabError(bad);
  if (!err) throw new Error('预期被拒，却通过了');
}, '复现：一个名字带逗号 → 整份 vocab 被宿主拒绝（吃饺子跟着一起失效）');

/* ② safeWordName 会洗掉禁字符、截到 32、空了退回 id */
check(() => {
  const cases = [
    ['是啊，吃什么', 'what-to-eat', '是啊吃什么'],
    ['【测试】', 'x', '测试'],
    ['hello world', 'x', 'helloworld'],
    ['', 'x', 'x'],
    [null, 'some-id', 'some-id'],
  ];
  for (const [raw, id, want] of cases) {
    const got = W.safeWordName(raw, id);
    if (got !== want) throw new Error(`${JSON.stringify(raw)} → ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`);
  }
  if (W.safeWordName('很长'.repeat(30), 'x').length !== 32) throw new Error('没截到 32 字');
}, 'safeWordName 洗名字（禁字符 / 32 字上限 / 空值退回 id）');

/* ③ vocabEntry 出来的条目必须过宿主校验 */
check(() => {
  const entry = W.vocabEntry({ word: 'what-to-eat', zh: '是啊，吃什么', category: 'mutter', catZh: '碎碎念', seconds: 10 });
  const err = hostVocabError([entry]);
  if (err) throw new Error(err);
}, 'vocabEntry 写出的条目通过宿主校验');

/* ④ 清单里 105 条全部合规则 */
check(() => {
  const cat = JSON.parse(readFileSync(join(here, '..', 'assets', 'catalog.json'), 'utf8').replace(/^\uFEFF/, ''));
  const vocab = cat.actions
    .filter((a) => a.word)
    .map((a) => W.vocabEntry({ ...a, catZh: a.catZh }));
  const err = hostVocabError(vocab);
  if (err) throw new Error(err);
}, '清单里全部 105 条都符合宿主规则');

/* ⑤ 老包修复：已经有坏名字的 figure.json 能被修回来（且幂等） */
check(() => {
  const root = join(here, '_tmp-vocab');
  rmSync(root, { recursive: true, force: true });
  const pack = join(root, 'pack');
  mkdirSync(pack, { recursive: true });
  writeFileSync(join(pack, 'figure.json'), JSON.stringify({
    manifest: 2, api: 2, id: 'shenshen-actions', entry: 'figure.js',
    vocab: [
      { id: 'what-to-eat', kind: 'motion', names: { zh: ['是啊，吃什么'] }, about: { zh: '碎碎念' }, seconds: 10 },
      { id: 'eat-dumplings', kind: 'motion', names: { zh: ['吃饺子'] }, about: { zh: '吃喝' }, seconds: 10 },
    ],
  }, null, 2), 'utf8');
  writeFileSync(join(pack, 'figure.js'), "const X = '额外动作拓展';", 'utf8');

  const before = hostVocabError(JSON.parse(readFileSync(join(pack, 'figure.json'), 'utf8')).vocab);
  if (!before) throw new Error('夹具本身应该是坏的');

  const r1 = S.ensureVocabNames(pack);
  if (!r1.changed) throw new Error('没有修复');
  const after = hostVocabError(JSON.parse(readFileSync(join(pack, 'figure.json'), 'utf8')).vocab);
  if (after) throw new Error('修完还是不合规：' + after);

  const r2 = S.ensureVocabNames(pack);
  if (r2.changed) throw new Error('第二次又写了');
  rmSync(root, { recursive: true, force: true });
}, '老包迁移：坏名字修好、修完通过宿主校验、幂等');

console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
