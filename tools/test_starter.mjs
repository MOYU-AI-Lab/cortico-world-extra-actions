/**
 * 自带入门套装的落地测试。
 *   node test_starter.mjs
 *
 * 覆盖：
 *   - 第一次启动：**什么都不写**（形象包位置、动作库放哪都由用户在面板里选）
 *   - 第二次：什么都不做（幂等）
 *   - seedPack:true → 铺的是空壳（无额外动作、词表空）
 *   - 用户已有的形象包不被覆盖
 *   - 用户已经指了动作库 → 不抢；指过但读不到 → 只提醒，不改设置
 *   - installStarterLibrary → 在用户选的目录下建「深深-动作库」，再建一次复用
 *   - 包里没有 assets/starter → 安静跳过，不报错
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const { ensureStarter, installStarterLibrary } = await import(pathToFileURL(join(here, '..', 'src', 'starter.js')).href);

const root = join(here, '_tmp-starter');
rmSync(root, { recursive: true, force: true });

/** 造一个假插件包：assets/starter/{figure,library}（自带 figure 里故意带一个动作和一个词，用来验证会被清空） */
function fakePkg(dir, { withStarter = true } = {}) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  if (!withStarter) return dir;
  const fig = join(dir, 'assets', 'starter', 'figure');
  mkdirSync(join(fig, 'actions', 'core', 'state-idle'), { recursive: true });
  writeFileSync(join(fig, 'figure.json'), JSON.stringify({ id: 'shenshen-actions', vocab: [{ id: 'pre-ticked', zh: '预置词' }] }));
  writeFileSync(join(fig, 'actions', 'core', 'state-idle', 'f_0001.webp'), 'x');
  writeFileSync(join(fig, 'figure.js'), 'export function createActionBody() {}\n');
  for (const s of ['state-walk', 'state-drag', 'look-around']) {
    mkdirSync(join(fig, 'actions', 'core', s), { recursive: true });
    writeFileSync(join(fig, 'actions', 'core', s, 'action.json'), JSON.stringify({ id: s }));
  }
  mkdirSync(join(fig, '额外动作拓展', 'eat', 'sample'), { recursive: true });
  writeFileSync(join(fig, '额外动作拓展', 'index.js'), 'export default [];\n');
  mkdirSync(join(dir, 'assets', 'starter', 'library', 'actions', 'core', 'state-idle'), { recursive: true });
  writeFileSync(join(dir, 'assets', 'starter', 'library', 'actions', 'index.js'), 'export default [];\n');
  return dir;
}

const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(msg + ' → ' + e.message); console.log('FAIL ' + msg); } };

const pkg = fakePkg(join(root, 'pkg'));
const figures = join(root, 'figures');
const data = join(root, 'data');
mkdirSync(data, { recursive: true });

const settings = { libraryDir: '' };
const ctx = {
  pkgDir: pkg,
  figuresDir: () => figures,
  dataDir: data,
  libraryDir: () => settings.libraryDir,
  saveSettings: (patch) => Object.assign(settings, patch),
  log: () => {},
};

/* 1. 第一次启动：**什么都不写** —— 形象包位置、动作库放哪都由用户在面板里选 */
const a = ensureStarter(ctx);
check(() => assert.equal(a.pack, false), 'first run does NOT auto-create a figure pack');
check(() => assert.equal(existsSync(join(figures, 'shenshen-actions')), false), 'no pack was written without the user picking a place');
check(() => assert.equal(a.library, null), 'the library is NOT auto-seeded');
check(() => assert.equal(existsSync(join(data, 'shenshen-library')), false), 'no library dir was created under dataDir');
check(() => assert.equal(settings.libraryDir, ''), 'libraryDir stays empty until the user chooses a place');

/* 2. 第二次：幂等 */
const b = ensureStarter(ctx);
check(() => assert.equal(b.pack, false), 'second run does not re-seed the pack');
check(() => assert.equal(b.library, null), 'second run does not re-seed the library');

/* 3. 显式 seedPack:true → 铺的是**空壳**（无额外动作、词表空） */
const seeded = ensureStarter({ ...ctx, seedPack: true });
check(() => assert.equal(seeded.pack, true), 'seedPack:true seeds a pack');
const seededDir = join(figures, 'shenshen-actions');
check(() => assert.equal(existsSync(join(seededDir, 'figure.js')), true), 'the seeded pack has a player');
check(() => assert.equal(existsSync(join(seededDir, '额外动作拓展')), false), 'the seeded pack is EMPTY (no 额外动作拓展)');
check(() => assert.equal(JSON.parse(readFileSync(join(seededDir, 'figure.json'), 'utf8')).vocab.length, 0), 'the seeded pack has an empty vocabulary');

/* 4. 用户的包不被覆盖 */
writeFileSync(join(seededDir, 'figure.json'), JSON.stringify({ id: 'shenshen-actions', vocab: [{ id: 'mine' }] }));
ensureStarter({ ...ctx, seedPack: true });
const kept = JSON.parse(readFileSync(join(seededDir, 'figure.json'), 'utf8'));
check(() => assert.deepEqual(kept.vocab, [{ id: 'mine' }]), 'an existing pack is never overwritten');

/* 5. 用户已经指了动作库 → 不抢 */
rmSync(join(root, 'data2'), { recursive: true, force: true });
const mine = join(root, 'my-library');
mkdirSync(join(mine, 'actions'), { recursive: true });
const ctx2 = { ...ctx, libraryDir: () => mine, saveSettings: (p) => Object.assign(settings, p) };
const c = ensureStarter(ctx2);
check(() => assert.equal(c.library, null), 'a library the user already pointed at is left alone');

/* 6. 用户指过库、但现在读不到（移动硬盘没插）→ 只提醒，绝不拿自带库顶替 */
const offline = join(root, 'unplugged-library');
const data3 = join(root, 'data3');
mkdirSync(data3, { recursive: true });
const offlineSettings = { libraryDir: offline };
const c2 = ensureStarter({
  ...ctx,
  dataDir: data3,
  libraryDir: () => offlineSettings.libraryDir,
  saveSettings: (p) => Object.assign(offlineSettings, p),
});
check(() => assert.equal(c2.library, null), 'an unreachable library does not get replaced by the bundled one');
check(() => assert.equal(c2.libraryMissing, offline), 'the unreachable path is reported instead');
check(() => assert.equal(offlineSettings.libraryDir, offline), 'the setting is left exactly as the user set it');
check(() => assert.equal(existsSync(join(data3, 'shenshen-library')), false), 'nothing was copied into dataDir');

/* 7. 用户选盘 → installStarterLibrary 在 <该目录>/深深-动作库 建（面板「用自带示例建库…」） */
const parent = join(root, 'D盘');
mkdirSync(parent, { recursive: true });
const lib = installStarterLibrary({ pkgDir: pkg, parentDir: parent });
check(() => assert.equal(lib.created, true), 'installStarterLibrary creates 深深-动作库');
check(() => assert.equal(lib.path, join(parent, '深深-动作库')), 'landed at <parent>/深深-动作库');
check(() => assert.equal(existsSync(join(lib.path, 'actions', 'index.js')), true), 'library has actions/index.js');
const lib2 = installStarterLibrary({ pkgDir: pkg, parentDir: parent });
check(() => assert.equal(lib2.created, false), 'calling again reuses the existing folder');
check(() => assert.equal(lib2.path, lib.path), 'same path returned');
check(() => { let e = null; try { installStarterLibrary({ pkgDir: pkg, parentDir: join(root, 'nope') }); } catch (x) { e = x; } assert.ok(e, 'a missing parent dir is refused'); }, 'a missing parent dir is refused');
check(() => { let e = null; try { installStarterLibrary({ pkgDir: pkg, parentDir: '' }); } catch (x) { e = x; } assert.ok(e, 'an empty parent dir is refused'); }, 'an empty parent dir is refused');

/* 8. 没有 starter 目录 → 安静跳过 */
const bare = fakePkg(join(root, 'bare'), { withStarter: false });
const d = ensureStarter({ ...ctx, pkgDir: bare, figuresDir: () => join(root, 'figures2'), libraryDir: () => '', saveSettings: () => {} });
check(() => assert.equal(d.skipped, 'no-starter') || assert.equal(d.pack, false), 'a package without assets/starter is a no-op');

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
