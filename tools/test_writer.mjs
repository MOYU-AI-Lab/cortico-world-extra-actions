/**
 * Headless test of the 额外动作拓展 writer: what the plugin writes, and what it takes back.
 *   node test_writer.mjs
 * Builds a throwaway library + pack under ./_tmp-writer and walks: save → add → remove → clear.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const W = await import(pathToFileURL(join(here, '..', 'src', 'writer.js')).href);

const root = join(here, '_tmp-writer');
rmSync(root, { recursive: true, force: true });

const CAT = { eat: '吃喝', fx: '特效' };
function fakeAction(lib, cat, id, zh, frames) {
  const dir = join(lib, 'actions', cat, id);
  mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= frames; i++) writeFileSync(join(dir, `f_${String(i).padStart(4, '0')}.webp`), Buffer.alloc(64, i));
  writeFileSync(join(dir, 'preview.webp'), Buffer.alloc(32));
  const entry = {
    id, zh, say: zh, category: cat, catZh: CAT[cat], clip: `actions/${cat}/${id}`,
    frames, fps: 24, seconds: Math.round((frames / 24) * 1000) / 1000, word: id,
    roles: [], noMirror: false, reaction: false, random: true, bytes: frames * 64,
  };
  writeFileSync(join(dir, 'action.json'), JSON.stringify(entry, null, 2));
  return entry;
}

const lib = join(root, 'lib');
const a1 = fakeAction(lib, 'eat', 'eat-dumplings', '吃饺子', 4);
const a2 = fakeAction(lib, 'fx', 'fireworks', '放烟花', 3);
const catalog = [a1, a2];

const pack = join(root, 'pack');
mkdirSync(pack, { recursive: true });
const originalVocab = [
  { id: 'happy', kind: 'expression', names: { zh: ['开心'] }, about: { zh: '眯眼笑' }, seconds: 0.9 },
  { id: 'cheer-wave', kind: 'motion', names: { zh: ['元气挥手'] }, about: { zh: '挥手' }, seconds: 10.042 },
];
const fig = {
  manifest: 2, api: 2, id: 'shenshen-test', version: '1.0.0',
  name: { zh: '测试包' }, about: { zh: '测试用' },
  entry: 'figure.js', export: 'createActionBody',
  axes: [], presets: [], vocab: originalVocab, sounds: {}, can: { walk: true }, moves: [], needs: [],
};
writeFileSync(join(pack, 'figure.json'), JSON.stringify(fig, null, 2));
writeFileSync(join(pack, 'figure.js'), '// 读 actions/index.js 和 额外动作拓展/index.js\nexport async function createActionBody(){}\n');

const readVocab = () => JSON.parse(readFileSync(join(pack, 'figure.json'), 'utf8')).vocab.map((w) => w.id);
const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(msg + ' → ' + e.message); console.log('FAIL ' + msg); } };

/* ---- 0. 包体检 ---- */
check(() => assert.equal(W.packLooksSupported(pack), true), 'recognises a frame-sequence pack');
const noEntry = join(root, 'other');
mkdirSync(noEntry, { recursive: true });
writeFileSync(join(noEntry, 'figure.json'), JSON.stringify(fig, null, 2));
check(() => assert.equal(W.packLooksSupported(noEntry), false), 'refuses a pack with no entry file');

/* ---- 1. 保存一段 ---- */
const r1 = W.save({ packDir: pack, ids: ['eat-dumplings'], catalog, libraryDir: lib, pack: { id: 'shenshen-test', name: '测试包' } });
const extra = join(pack, '额外动作拓展');
check(() => assert.deepEqual(r1.copied, ['eat-dumplings']), 'copies the chosen module');
check(() => assert.equal(readdirSync(join(extra, 'eat', 'eat-dumplings')).filter((n) => /^f_/.test(n)).length, 4), 'all 4 frames landed');
check(() => assert.ok(existsSync(join(extra, 'index.js'))), 'writes index.js for the pet');
check(() => assert.ok(existsSync(join(extra, 'index.json'))), 'writes index.json for tools');
check(() => assert.ok(existsSync(join(extra, 'README.md'))), 'writes README.md');
check(() => assert.deepEqual(readVocab(), ['happy', 'eat-dumplings']), 'vocab = expressions + only the ticked action (cheer-wave was not ticked)');
check(() => assert.ok(existsSync(join(pack, 'figure.json.bak-额外动作拓展'))), 'keeps a figure.json backup');
check(() => assert.deepEqual(W.readExtra(pack).ids, ['eat-dumplings']), 'remembers what it manages');

const idx = readFileSync(join(extra, 'index.js'), 'utf8');
check(() => assert.match(idx, /word: "eat-dumplings"/), 'index.js carries the word');
check(() => assert.match(idx, /clip: "额外动作拓展\/eat\/eat-dumplings"/), 'index.js path is pack-relative');
check(() => assert.match(idx, /frames: 4/), 'index.js carries the frame count');

/* ---- 2. 再加一段 ---- */
const r2 = W.save({ packDir: pack, ids: ['eat-dumplings', 'fireworks'], catalog, libraryDir: lib, pack: { id: 'shenshen-test', name: '测试包' } });
check(() => assert.deepEqual(r2.copied, ['fireworks']) && assert.deepEqual(r2.skipped, ['eat-dumplings']), 'adding copies only the new one, the old is left alone');
check(() => assert.deepEqual(readVocab(), ['happy', 'eat-dumplings', 'fireworks']), 'vocab has both ticked actions');
check(() => assert.equal(W.readExtra(pack).ids.length, 2), 'two modules tracked');

/* ---- 3. 取消一段 ---- */
const r3 = W.save({ packDir: pack, ids: ['fireworks'], catalog, libraryDir: lib, pack: { id: 'shenshen-test', name: '测试包' } });
check(() => assert.deepEqual(r3.removed, ['eat-dumplings']), 'unticking removes the module');
check(() => assert.equal(existsSync(join(extra, 'eat', 'eat-dumplings')), false), 'its frames are gone');
check(() => assert.deepEqual(readVocab(), ['happy', 'fireworks']), 'unticking also takes its word out of figure.json');
check(() => assert.deepEqual(r3.vocab.removed, ['eat-dumplings']), 'reports the removed word');

/* ---- 4. 保存同一份是幂等的 ---- */
const before = readFileSync(join(extra, 'index.js'), 'utf8');
const r4 = W.save({ packDir: pack, ids: ['fireworks'], catalog, libraryDir: lib, pack: { id: 'shenshen-test', name: '测试包' } });
check(() => assert.deepEqual(r4.skipped, ['fireworks']), 'a repeat save copies nothing again');
check(() => assert.equal(readFileSync(join(extra, 'index.js'), 'utf8'), before), 'and writes the same manifest');

/* ---- 5. 清空 ---- */
const r5 = W.clear(pack, catalog, 'shenshen-test');
check(() => assert.equal(existsSync(extra), false), 'clear removes the whole folder');
check(() => assert.deepEqual(readVocab(), ['happy', 'cheer-wave']), 'clear restores the original vocabulary exactly');
check(() => assert.deepEqual(r5.vocab.removed, ['fireworks']), 'clear reports what it removed');

/* ---- 6. 不存在的动作 id 被忽略 ---- */
check(() => {
  let threw = false;
  try { W.save({ packDir: pack, ids: ['no-such-action'], catalog, libraryDir: lib, pack: { id: 'shenshen-test' } }); } catch { threw = true; }
  assert.equal(threw, true);
}, 'saving an empty selection throws rather than writing an empty folder');

/* ---- 6b. 删除单个动作 ---- */
W.save({ packDir: pack, ids: ['eat-dumplings', 'fireworks'], catalog, libraryDir: lib, pack: { id: 'shenshen-test' } });
const r6a = W.removeOne({ packDir: pack, id: 'eat-dumplings', catalog, libraryDir: lib, pack: { id: 'shenshen-test' } });
check(() => assert.equal(r6a.removed, 'eat-dumplings'), 'removeOne names what it removed');
check(() => assert.equal(r6a.remaining, 1), 'one action left');
check(() => assert.equal(existsSync(join(extra, 'eat', 'eat-dumplings')), false), 'its folder is gone');
check(() => assert.deepEqual(readVocab(), ['happy', 'fireworks']), 'its word left figure.json too');
check(() => assert.equal(existsSync(join(extra, 'fx', 'fireworks')), true), 'the other action stays');
const r6b = W.removeOne({ packDir: pack, id: 'fireworks', catalog, libraryDir: lib, pack: { id: 'shenshen-test' } });
check(() => assert.equal(r6b.cleared, true), 'removing the last one clears the folder');
check(() => assert.equal(existsSync(extra), false), 'folder is gone');
check(() => assert.deepEqual(readVocab(), ['happy', 'cheer-wave']), 'vocab restored to before the selection');
check(() => {
  let threw = false;
  try { W.removeOne({ packDir: pack, id: 'fireworks', catalog, libraryDir: lib, pack: { id: 'shenshen-test' } }); } catch { threw = true; }
  assert.equal(threw, true);
}, 'removing something that is not installed throws');

/* ---- 7. 体检 ---- */
const ins = W.inspect({ packDir: pack, libraryDir: lib, catalog });
check(() => assert.equal(ins.ok, true), 'inspect: library and pack look fine');
check(() => assert.equal(W.inspect({ packDir: pack, libraryDir: lib + '-nope', catalog }).ok, false), 'inspect: missing library is reported');

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
