/**
 * 自带素材的落地测试。
 *   node test_starter.mjs
 *
 * 契约（0.3.7 起）：
 *   - ensureStarter 只铺**形象包**，动作库不再自动铺（放哪个盘由用户决定）
 *   - installStarterLibrary 在用户选的目录下建 `<目录>/深深-动作库`，已存在就直接复用
 *   - 用户已有的形象包不被覆盖
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(join(here, '..', 'src', 'starter.js')).href);
const { ensureStarter, installStarterLibrary } = mod;

const root = join(here, '_tmp-starter');
rmSync(root, { recursive: true, force: true });

function fakePkg(dir, { withStarter = true } = {}) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  if (!withStarter) return dir;
  mkdirSync(join(dir, 'assets', 'starter', 'figure', 'actions', 'core', 'state-idle'), { recursive: true });
  writeFileSync(join(dir, 'assets', 'starter', 'figure', 'figure.json'), JSON.stringify({ id: 'shenshen-actions' }));
  writeFileSync(join(dir, 'assets', 'starter', 'figure', 'actions', 'core', 'state-idle', 'f_0001.webp'), 'x');
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

/* 1. 形象包会铺，动作库不铺 */
const a = ensureStarter(ctx);
check(() => assert.equal(a.pack, true), 'first run seeds the figure pack');
check(() => assert.equal(existsSync(join(figures, 'shenshen-actions', 'figure.json')), true), 'pack landed in figures/shenshen-actions');
check(() => assert.equal(a.library, null), 'the library is NOT auto-seeded any more');
check(() => assert.equal(settings.libraryDir, ''), 'nothing written into libraryDir without the user choosing');

/* 2. 幂等 */
const b = ensureStarter(ctx);
check(() => assert.equal(b.pack, false), 'second run does not re-seed the pack');

/* 3. 用户的包不被覆盖 */
writeFileSync(join(figures, 'shenshen-actions', 'figure.json'), JSON.stringify({ id: 'shenshen-actions', vocab: [{ id: 'mine' }] }));
ensureStarter(ctx);
check(() => assert.deepEqual(JSON.parse(readFileSync(join(figures, 'shenshen-actions', 'figure.json'), 'utf8')).vocab, [{ id: 'mine' }]), 'an existing pack is never overwritten');

/* 4. 用户选盘 → 在指定位置建库 */
const parent = join(root, 'D盘');
mkdirSync(parent, { recursive: true });
const lib = installStarterLibrary({ pkgDir: pkg, parentDir: parent });
check(() => assert.equal(lib.created, true), 'installStarterLibrary creates 深深-动作库');
check(() => assert.equal(lib.path, join(parent, '深深-动作库')), 'landed at <parent>/深深-动作库');
check(() => assert.equal(existsSync(join(lib.path, 'actions', 'index.js')), true), 'library has actions/index.js');

/* 5. 再建一次 → 复用，不重复拷 */
const lib2 = installStarterLibrary({ pkgDir: pkg, parentDir: parent });
check(() => assert.equal(lib2.created, false), 'calling again reuses the existing folder');
check(() => assert.equal(lib2.path, lib.path), 'same path returned');

/* 6. 目录不存在 / 参数空 → 报错 */
check(() => { let e = null; try { installStarterLibrary({ pkgDir: pkg, parentDir: join(root, 'nope') }); } catch (x) { e = x; } assert.match(String(e?.message), /目录不存在/); }, 'a missing parent dir is refused');
check(() => { let e = null; try { installStarterLibrary({ pkgDir: pkg, parentDir: '' }); } catch (x) { e = x; } assert.match(String(e?.message), /没有选择目录/); }, 'an empty choice is refused');

/* 7. 没有 starter → 安静跳过 */
const bare = fakePkg(join(root, 'bare'), { withStarter: false });
const d = ensureStarter({ ...ctx, pkgDir: bare, figuresDir: () => join(root, 'figures2') });
check(() => assert.equal(d.skipped, 'no-starter'), 'a package without assets/starter is a no-op');

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
