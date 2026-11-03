/**
 * 单文件动画模块（高清库格式）的测试。
 *   node test_single.mjs
 *
 * 覆盖：
 *   - scanLibrary 认得 anim.webp 并把 anim 标为 true
 *   - writer.save 把 anim.webp 整个拷进包（不拆帧），action.json/index.js 都带 anim: true
 *   - 「添加更多动作」也能收单文件模块
 *   - 单文件模块重复保存不重复拷
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '_tmp-single');
rmSync(root, { recursive: true, force: true });

/** 合成一张合法 webp 头（640×360） */
function fakeWebp(w = 640, h = 360) {
  const buf = Buffer.alloc(64);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(56, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8L', 12, 'ascii');
  buf.writeUInt32LE(4, 16);
  buf[20] = 0x2f;
  buf.writeUInt32LE(((((h - 1) << 14) | (w - 1)) >>> 0), 21);
  return buf;
}

const W = await import(pathToFileURL(join(here, '..', 'src', 'writer.js')).href);
const I = await import(pathToFileURL(join(here, '..', 'src', 'importer.js')).href);

const lib = join(root, 'lib');
const modDir = join(lib, 'actions', 'eat', 'eat-dumplings');
mkdirSync(modDir, { recursive: true });
writeFileSync(join(modDir, 'anim.webp'), fakeWebp());
writeFileSync(join(modDir, 'preview.webp'), fakeWebp(240, 135));
writeFileSync(join(modDir, 'action.json'), JSON.stringify({
  id: 'eat-dumplings', zh: '吃饺子', category: 'eat', clip: 'actions/eat/eat-dumplings',
  frames: 241, fps: 24, seconds: 10.042, word: 'eat-dumplings', anim: true,
}, null, 2));
writeFileSync(join(lib, 'actions', 'index.js'), 'export default [];\n');

const pack = join(root, 'pack');
mkdirSync(pack, { recursive: true });
writeFileSync(join(pack, 'figure.json'), JSON.stringify({ manifest: 2, api: 2, id: 'p1', entry: 'figure.js', vocab: [] }));
writeFileSync(join(pack, 'figure.js'), "const a = '额外动作拓展/index.js';\nexport function createActionBody() {}\n");

const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(msg + ' → ' + e.message); console.log('FAIL ' + msg); } };

/* 1) scanLibrary 认得单文件模块 */
const scanned = I.scanLibrary(lib);
const one = scanned.get('eat-dumplings');
check(() => assert.ok(one, 'scanLibrary finds the single-file module'));
check(() => assert.equal(one.anim, true), 'scanLibrary marks anim: true');
check(() => assert.equal(one.frames, 241), 'frame count comes from action.json (' + one.frames + ')');

/* 2) 保存：整段 anim.webp 进包 */
const catalog = [{
  id: 'eat-dumplings', zh: '吃饺子', category: 'eat', clip: 'actions/eat/eat-dumplings',
  frames: 241, fps: 24, seconds: 10.042, word: 'eat-dumplings', anim: true, present: true,
}];
const r = W.save({ packDir: pack, ids: ['eat-dumplings'], catalog, libraryDir: lib, pack: { id: 'p1', name: 'P1' } });
const extraDir = join(pack, '额外动作拓展', 'eat', 'eat-dumplings');
check(() => assert.equal(r.copied.length, 1), 'save copies the module');
check(() => assert.equal(existsSync(join(extraDir, 'anim.webp')), true), 'anim.webp landed in the pack');
check(() => assert.equal(existsSync(join(extraDir, 'f_0001.webp')), false), 'no frame files were created');
const meta = JSON.parse(readFileSync(join(extraDir, 'action.json'), 'utf8'));
check(() => assert.equal(meta.anim, true), 'copied action.json keeps anim: true');
const manifest = readFileSync(join(pack, '额外动作拓展', 'index.js'), 'utf8');
check(() => assert.match(manifest, /anim: true/), 'pack manifest carries anim: true for the player');
check(() => assert.match(manifest, /word: "eat-dumplings"/), 'pack manifest keeps the word');

/* 3) 重复保存不重复拷 */
const r2 = W.save({ packDir: pack, ids: ['eat-dumplings'], catalog, libraryDir: lib, pack: { id: 'p1' } });
check(() => assert.equal(r2.copied.length, 0), 'a repeat save copies nothing again');

/* 4)「添加更多动作」也收单文件 */
const src2 = join(root, 'incoming');
mkdirSync(join(src2, 'ride-bike'), { recursive: true });
writeFileSync(join(src2, 'ride-bike', 'anim.webp'), fakeWebp());
writeFileSync(join(src2, 'ride-bike', 'action.json'), JSON.stringify({ id: 'ride-bike', zh: '骑自行车', category: 'extra', frames: 241, fps: 24 }));
const lib2 = join(root, 'lib2');
mkdirSync(join(lib2, 'actions'), { recursive: true });
writeFileSync(join(lib2, 'actions', 'index.js'), 'export default [];\n');
const added = I.addModules({ sourceDir: src2, libraryDir: lib2, existingIds: new Set() });
check(() => assert.equal(added.added.length, 1), 'import accepts a single-file module');
check(() => assert.equal(existsSync(join(lib2, 'actions', 'extra', 'ride-bike', 'anim.webp')), true), 'import copies anim.webp as-is');
const idx = readFileSync(join(lib2, 'actions', 'index.js'), 'utf8');
check(() => assert.match(idx, /anim: true/), 'library index records anim: true');

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
