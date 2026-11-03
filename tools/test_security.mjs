/**
 * 注入面测试：清单/参数/库目录都当不可信输入，看 writer 会不会被带偏。
 *   node test_security.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const W = await import(pathToFileURL(join(here, '..', 'src', 'writer.js')).href);

const root = join(here, '_tmp-security');
rmSync(root, { recursive: true, force: true });
const lib = join(root, 'lib');
const pack = join(root, 'pack');

const good = {
  id: 'eat-dumplings', zh: '吃饺子', say: '吃饺子', category: 'eat', catZh: '吃喝',
  clip: 'actions/eat/eat-dumplings', frames: 3, fps: 24, seconds: 0.125, word: 'eat-dumplings',
  roles: [], noMirror: false, reaction: false, random: true, bytes: 192,
};
const dir = join(lib, 'actions', 'eat', 'eat-dumplings');
mkdirSync(dir, { recursive: true });
for (let i = 1; i <= 3; i++) writeFileSync(join(dir, `f_${String(i).padStart(4, '0')}.webp`), Buffer.alloc(64, i));
writeFileSync(join(dir, 'preview.webp'), Buffer.alloc(32));
writeFileSync(join(dir, 'action.json'), JSON.stringify(good));

mkdirSync(pack, { recursive: true });
writeFileSync(join(pack, 'figure.json'), JSON.stringify({
  manifest: 2, api: 2, id: 'shenshen-test', name: { zh: '测试' }, about: { zh: '测试' },
  entry: 'figure.js', export: 'createActionBody', vocab: [], axes: [], presets: [], sounds: {}, can: { walk: true }, moves: [], needs: [],
}, null, 2));
writeFileSync(join(pack, 'figure.js'), '// 额外动作拓展\nexport async function createActionBody(){}\n');

const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(msg + ' → ' + e.message); console.log('FAIL ' + msg); } };
const throws = (fn, re) => {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err, '应该抛错');
  if (re) assert.match(String(err.message), re);
};

/* 1. 清单条目本身不可信：id / 触发词 / 路径 / 帧数 / 时长 */
check(() => assert.ok(W.actionProblem(good) === null), 'valid entry passes');
check(() => assert.match(W.actionProblem({ ...good, word: "x';process.exit(1);//" }) ?? '', /触发词/), 'a word that is not a slug is refused');
check(() => assert.match(W.actionProblem({ ...good, id: 'eat-dumplings/../../evil' }) ?? '', /id 不合法/), 'a path in the id is refused');
check(() => assert.match(W.actionProblem({ ...good, clip: 'actions/eat/../../evil' }) ?? '', /路径/), 'a climbing clip is refused');
check(() => assert.match(W.actionProblem({ ...good, category: '../evil' }) ?? '', /分类/), 'a category with .. is refused');
check(() => assert.match(W.actionProblem({ ...good, frames: 999999 }) ?? '', /帧数/), 'an absurd frame count is refused');
check(() => assert.match(W.actionProblem({ ...good, seconds: 1e9 }) ?? '', /时长/), 'an absurd duration is refused');
check(() => assert.match(W.actionProblem({ ...good, clip: 'actions/eat/other' }) ?? '', /对不上/), 'clip must match category/id');

/* 2. 保存时的参数闸门 */
check(() => throws(() => W.save({ packDir: 'relative/path', ids: ['eat-dumplings'], catalog: [good], libraryDir: lib }), /绝对路径|不是形象包/), 'relative pack dir refused');
check(() => throws(() => W.save({ packDir: pack, ids: ['eat-dumplings'], catalog: [good], libraryDir: 'relative/lib' }), /绝对路径/), 'relative library dir refused');
check(() => throws(() => W.save({ packDir: pack, ids: Array.from({ length: 301 }, () => 'eat-dumplings'), catalog: [good], libraryDir: lib }), /最多/), 'over 300 ids refused');
check(() => throws(() => W.save({ packDir: pack, ids: ['eat-dumplings'], catalog: [{ ...good, word: "x';" }], libraryDir: lib }), /不可用/), 'a tampered catalog entry is refused before writing');

/* 3. 库目录里多放的东西不会被带进包 */
writeFileSync(join(dir, 'payload.js'), 'globalThis.pwned = 1;\n');
writeFileSync(join(dir, 'evil.exe'), Buffer.alloc(16));
let symlinked = false;
try {
  symlinkSync(join(root, 'outside.webp'), join(dir, 'f_0003.webp'), 'file');
  symlinked = true;
} catch { /* Windows 上没权限就是没有，跳过符号链接那一条 */ }

if (symlinked) {
  check(() => throws(() => W.save({ packDir: pack, ids: ['eat-dumplings'], catalog: [good], libraryDir: lib }), /符号链接/), 'a symlinked frame is refused');
  writeFileSync(join(dir, 'f_0003.webp'), Buffer.alloc(64, 3));
} else {
  console.log('skip  symlink case (no privilege to create one)');
}

const r = W.save({ packDir: pack, ids: ['eat-dumplings'], catalog: [good], libraryDir: lib, pack: { id: 'shenshen-test' } });
const out = join(pack, '额外动作拓展', 'eat', 'eat-dumplings');
const files = readdirSync(out).sort();
check(() => assert.deepEqual(files, ['action.json', 'f_0001.webp', 'f_0002.webp', 'f_0003.webp', 'preview.webp']), 'only frames + preview + our own action.json are copied (' + files.join(',') + ')');
check(() => assert.equal(existsSync(join(pack, '额外动作拓展', 'eat', 'eat-dumplings', 'payload.js')), false), 'a stray script in the library never reaches the pack');
check(() => assert.equal(r.count, 1), 'one module written');

/* 4. 生成的 index.js 里没有可逃逸的字符串 */
const nasty = { ...good, id: 'evil-name', word: 'evil-name', say: "a'*/; globalThis.pwned=1;/*", zh: "a'\n; x", clip: 'actions/eat/evil-name' };
const dir2 = join(lib, 'actions', 'eat', 'evil-name');
mkdirSync(dir2, { recursive: true });
for (let i = 1; i <= 3; i++) writeFileSync(join(dir2, `f_${String(i).padStart(4, '0')}.webp`), Buffer.alloc(64, i));
const r2 = W.save({ packDir: pack, ids: ['evil-name'], catalog: [nasty], libraryDir: lib, pack: { id: 'shenshen-test' } });
const js = readFileSync(join(pack, '额外动作拓展', 'index.js'), 'utf8');
check(() => assert.equal(r2.count, 1), 'the nasty entry is written as data, not code');
check(() => assert.equal(/globalThis/.test(js.replace(/[^]*\*\/$/, '')), false), 'no statement escapes the string literal');
const mod = await import(pathToFileURL(join(pack, '额外动作拓展', 'index.js')).href + '?v=' + Date.now());
check(() => assert.equal(mod.default[0].word, 'evil-name'), 'the manifest still parses as data');
check(() => assert.equal(mod.default[0].name.includes('\n'), false), 'control characters are stripped from the name');
check(() => assert.equal(globalThis.pwned, undefined), 'importing it executes nothing');

/* 5. 写进角色包的东西不带本机路径：这个文件夹会跟着包一起被分享 */
const walkPack = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkPack(p, out); else out.push(p);
  }
  return out;
};
const leaks = walkPack(join(pack, '额外动作拓展'))
  .filter((f) => /\.(json|js|md)$/.test(f))
  .flatMap((f) => readFileSync(f, 'utf8').split(/\r?\n/)
    .filter((line) => /[A-Za-z]:[\\/]|^\s*"?(library|libraryDir)"?\s*:/.test(line) && !/w3\.org/.test(line))
    .map((line) => `${f.split(/[\\/]/).pop()}: ${line.trim().slice(0, 80)}`));
check(() => assert.deepEqual(leaks, []), 'no absolute path or library path is written into the pack (' + leaks.join(' | ') + ')');

/* 6. 清空只动 额外动作拓展 自己 */
writeFileSync(join(pack, '额外动作拓展', 'keep.txt'), 'x');
W.clear(pack, [good], 'shenshen-test');
check(() => assert.equal(existsSync(join(pack, '额外动作拓展')), false), 'clear removes the folder');
check(() => assert.equal(existsSync(join(pack, 'figure.json')), true), 'clear leaves figure.json in place');
check(() => assert.equal(existsSync(join(pack, 'figure.json.bak-额外动作拓展')), true), 'the backup survives clear');

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
