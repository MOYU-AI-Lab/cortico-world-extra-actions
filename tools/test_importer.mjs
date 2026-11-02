/**
 * 「添加更多动作」的测试：把一套帧收进动作库。
 *   node test_importer.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const I = await import(pathToFileURL(join(here, '..', 'src', 'importer.js')).href);
const LIB_SRC = (process.env.SHENSHEN_LIBRARY || 'C:/Users/11436/Desktop/深深-动作库') + '/actions/eat/eat-dumplings';

const root = join(here, '_tmp-import');
rmSync(root, { recursive: true, force: true });
const lib = join(root, 'lib');
const src = join(root, 'src');
mkdirSync(join(lib, 'actions', 'eat'), { recursive: true });
mkdirSync(src, { recursive: true });
mkdirSync(join(lib, 'actions', 'eat', 'old-one'), { recursive: true });
writeFileSync(join(lib, 'actions', 'eat', 'old-one', 'action.json'), JSON.stringify({ id: 'old-one', zh: '旧', category: 'eat', frames: 2, fps: 24, seconds: 0.083, word: 'old-one' }));
writeFileSync(join(lib, 'actions', 'index.js'), "export default [\n  { id: 'old-one', zh: '旧', category: 'eat', clip: 'actions/eat/old-one', frames: 2, fps: 24, seconds: 0.083, word: 'old-one' },\n];\n");

const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(msg + ' → ' + e.message); console.log('FAIL ' + msg); } };
const throws = (fn, re) => {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err, '应该抛错');
  if (re) assert.match(String(err.message), re);
};

/** 用真实帧造一套 4 帧的素材目录。 */
function makeModule(dir, frames = 4) {
  mkdirSync(dir, { recursive: true });
  const all = readdirSync(LIB_SRC).filter((f) => /^f_\d{4}\.webp$/.test(f)).sort();
  for (let i = 0; i < frames; i++) copyFileSync(join(LIB_SRC, all[i]), join(dir, `f_${String(i + 1).padStart(4, '0')}.webp`));
  return dir;
}

/* ---- 1. 单个模块 ---- */
const mod = makeModule(join(src, 'wave-hello'));
writeFileSync(join(mod, 'payload.js'), 'globalThis.pwned = 1;\n');
const r = I.addModules({
  sourceDir: mod,
  libraryDir: lib,
  existingIds: new Set(['old-one']),
  thumbFor: () => 'data:image/webp;base64,AAAA',
});
check(() => assert.equal(r.added.length, 1), 'one module added');
const entry = r.added[0];
check(() => assert.equal(entry.id, 'wave-hello'), 'id came from the folder name: ' + entry.id);
check(() => assert.equal(entry.frames, 4), 'frame count: ' + entry.frames);
check(() => assert.equal(entry.seconds, 0.167), 'seconds from frames/fps: ' + entry.seconds);
const dst = join(lib, 'actions', 'extra', entry.id);
check(() => assert.equal(existsSync(join(dst, 'action.json')), true), 'action.json written');
check(() => assert.deepEqual(readdirSync(dst).sort(), ['action.json', 'f_0001.webp', 'f_0002.webp', 'f_0003.webp', 'f_0004.webp']), 'only frames + our own action.json');
check(() => assert.equal(existsSync(join(dst, 'payload.js')), false), 'a stray file in the source never reaches the library');
const idx = readFileSync(join(lib, 'actions', 'index.js'), 'utf8');
check(() => assert.match(idx, /id: "wave-hello"/), 'index.js gained the module');
const mod2 = await import(pathToFileURL(join(lib, 'actions', 'index.js')).href + '?v=' + Date.now());
check(() => assert.equal(mod2.default.length, 2), 'index.js still parses, 2 entries (old-one kept, wave-hello added)');
check(() => assert.equal(mod2.default.find((e) => e.id === 'wave-hello')?.clip, 'actions/extra/wave-hello'), 'clip path is right');

/* ---- 2. action.json 指定 id/名字/分类 ---- */
const m2 = makeModule(join(src, 'raw'), 3);
writeFileSync(join(m2, 'action.json'), JSON.stringify({ id: 'eat-burger', zh: '吃汉堡', category: 'eat', fps: 30 }));
const r2 = I.addModules({ sourceDir: m2, libraryDir: lib, existingIds: new Set(mod2.default.map((e) => e.id)) });
check(() => assert.equal(r2.added[0].id, 'eat-burger'), 'action.json id wins');
check(() => assert.equal(r2.added[0].zh, '吃汉堡'), 'action.json name wins');
check(() => assert.equal(r2.added[0].fps, 30), 'action.json fps wins');
check(() => assert.equal(r2.added[0].seconds, 0.1), 'seconds follow fps: ' + r2.added[0].seconds);

/* ---- 3. 同 id 自动改名 ---- */
const m3 = makeModule(join(src, 'again'), 2);
const r3 = I.addModules({ sourceDir: m3, libraryDir: lib, existingIds: new Set(['wave-hello', 'eat-burger', 'again']) });
check(() => assert.equal(r3.added[0].id, 'again-2'), 'a taken id gets a suffix: ' + r3.added[0].id);

/* ---- 4. 父目录：一次收多个 ---- */
const multi = join(root, 'multi');
makeModule(join(multi, 'a-one'), 2);
makeModule(join(multi, 'b-two'), 2);
mkdirSync(join(multi, 'empty'), { recursive: true });
const r4 = I.addModules({ sourceDir: multi, libraryDir: lib, existingIds: new Set() });
check(() => assert.deepEqual(r4.added.map((x) => x.id).sort(), ['a-one', 'b-two']), 'parent folder: every child module is added');
check(() => assert.equal(r4.skipped.length, 0), 'an empty sibling is simply not a candidate');

/* ---- 5. 拒绝坏输入 ---- */
check(() => throws(() => I.addModules({ sourceDir: relative_(), libraryDir: lib }), /绝对路径/), 'relative source refused');
check(() => throws(() => I.addModules({ sourceDir: join(root, 'nope'), libraryDir: lib }), /不存在/), 'missing folder refused');
const emptyDir = join(root, 'empty-dir');
mkdirSync(emptyDir, { recursive: true });
check(() => throws(() => I.addModules({ sourceDir: emptyDir, libraryDir: lib }), /没有动作帧/), 'a folder without frames is refused');
const bad = join(root, 'bad');
mkdirSync(bad, { recursive: true });
writeFileSync(join(bad, 'f_0001.webp'), Buffer.from('not a webp at all, just text padded to 40 bytes...'));
const r5 = I.addModules({ sourceDir: bad, libraryDir: lib, existingIds: new Set() });
check(() => assert.equal(r5.added.length, 0) && r5.skipped.length === 1, 'a non-webp frame is skipped with a reason');

function relative_() { return 'relative/path'; }

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
