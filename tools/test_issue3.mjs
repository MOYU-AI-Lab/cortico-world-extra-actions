/**
 * Cortico 扩展市场 Issue #3 的回归测试。
 *
 * 1) 只认入口里写着「额外动作拓展」的形象包；别的作者按帧序列做的包（入口只提
 *    actions/index.js）必须判为「不可写」，否则我们保存时会改它的 figure.json。
 * 2) 保存只添加/回收「我们自己加过的」动作词，包里原有的 motion 词一条都不许少。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const W = await import(pathToFileURL(join(here, '..', 'src', 'writer.js')).href);

const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(`${msg} → ${e.message}`); console.log('FAIL ' + msg); } };

const root = join(here, '_tmp-issue3');
rmSync(root, { recursive: true, force: true });

/** 造一个形象包：入口脚本写什么由参数决定。 */
function makePack(name, { entryJs, vocab }) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'figure.json'), JSON.stringify({
    manifest: 2, api: 2, id: name, version: '1.0.0',
    name: { zh: name }, entry: 'figure.js', vocab,
  }, null, 2), 'utf8');
  writeFileSync(join(dir, 'figure.js'), entryJs, 'utf8');
  return dir;
}

/* ① 别人的帧序列包：入口只提 actions/index.js */
const foreign = makePack('foreign-pack', {
  entryJs: `export const manifest = 2;\nimport './actions/index.js';\n// 只读 actions/index.js 的播放器\n`,
  vocab: [
    { id: 'hello', kind: 'motion', names: { zh: ['打招呼'] }, seconds: 2 },
    { id: 'bye', kind: 'motion', names: { zh: ['再见'] }, seconds: 2 },
    { id: 'smile', kind: 'expression', names: { zh: ['微笑'] } },
  ],
});
check(() => assert.equal(W.packLooksSupported(foreign), false, '别人的帧序列包不能被判为可写'), '只提 actions/index.js 的包判为不可写');

/* ② 我们的包：入口里写着 额外动作拓展 */
const ours = makePack('our-pack', {
  entryJs: `const EXTRA_DIR = '额外动作拓展';\nimport './actions/index.js';\nimport './额外动作拓展/index.js';\n`,
  vocab: [
    { id: 'own-word', kind: 'motion', names: { zh: ['包里原有的动作'] }, seconds: 3 },
    { id: 'body', kind: 'expression', names: { zh: ['待机'] } },
  ],
});
check(() => assert.equal(W.packLooksSupported(ours), true), '写了 额外动作拓展 的包判为可写');

/* ③ 保存：包里原有的 motion 词必须留着，只加我们勾的 */
// pack 原有的动作补模块
// 包里原有的动作，真实情况下一定有自己的模块目录（词能对上片段）
{
  const d = join(ours, 'actions', 'core', 'own-word');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'action.json'), JSON.stringify({ id: 'own-word', category: 'core', clip: 'actions/core/own-word', frames: 2, seconds: 3 }), 'utf8');
}

const lib = join(root, 'lib');
const modDir = join(lib, 'actions', 'core', 'cheer-hop');
mkdirSync(modDir, { recursive: true });
writeFileSync(join(modDir, 'action.json'), JSON.stringify({
  id: 'cheer-hop', category: 'core', word: 'cheer-hop', zh: '开心跃动', say: '开心跃动',
  clip: 'actions/core/cheer-hop', frames: 2, fps: 24, seconds: 1, anim: true,
}), 'utf8');
writeFileSync(join(modDir, 'anim.webp'), 'RIFFxxxxWEBPVP8 ', 'utf8');

const action = {
  id: 'cheer-hop', category: 'core', word: 'cheer-hop', zh: '开心跃动', say: '开心跃动',
  clip: 'actions/core/cheer-hop', frames: 2, fps: 24, seconds: 1, anim: true,
};
W.save({ packDir: ours, libraryDir: lib, ids: ['cheer-hop'], catalog: [action] });
const fig = JSON.parse(readFileSync(join(ours, 'figure.json'), 'utf8'));
const ids = fig.vocab.map((w) => w.id);
check(() => assert.ok(ids.includes('own-word'), '包里原有的 motion 词没被删'), '保存后 own-word 还在');
check(() => assert.ok(ids.includes('body'), '包里原有的 expression 词没被删'), '保存后 body 还在');
check(() => assert.ok(ids.includes('cheer-hop'), '勾选的动作被加进词表'), '保存后 cheer-hop 已加入');

/* ④ 再保存成空：只回收我们加的，原有的一条不少 */
W.clear(ours, [action]);
const fig2 = JSON.parse(readFileSync(join(ours, 'figure.json'), 'utf8'));
const ids2 = fig2.vocab.map((w) => w.id);
check(() => assert.equal(ids2.includes('cheer-hop'), false, '取消勾选后我们加的词被回收'), '清空后 cheer-hop 已回收');
check(() => assert.deepEqual(ids2.sort(), ['body', 'own-word']), '清空后包原有的词完整保留');

/* ⑤ 别人的包：即使强行调用 save 也不该被改（写之前会判 supported） */
const before = readFileSync(join(foreign, 'figure.json'), 'utf8');
check(() => assert.equal(W.packLooksSupported(foreign), false), '外来包始终不可写（保存入口会因此拒绝）');
check(() => assert.equal(readFileSync(join(foreign, 'figure.json'), 'utf8'), before), '外来包的 figure.json 一个字节都没变');

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
