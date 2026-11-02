/**
 * 自带入门套装的落地测试。
 *   node test_starter.mjs
 *
 * 覆盖：
 *   - 第一次：形象包铺到 figures、小动作库铺到 dataDir 并写进设置
 *   - 第二次：什么都不做（幂等）
 *   - 用户已有的形象包不被覆盖
 *   - 用户已经指了动作库 → 不抢
 *   - 包里没有 assets/starter → 安静跳过，不报错
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const { ensureStarter } = await import(pathToFileURL(join(here, '..', 'src', 'starter.js')).href);

const root = join(here, '_tmp-starter');
rmSync(root, { recursive: true, force: true });

/** 造一个假插件包：assets/starter/{figure,library} */
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

/* 1. 第一次 */
const a = ensureStarter(ctx);
check(() => assert.equal(a.pack, true), 'first run seeds the figure pack');
check(() => assert.equal(existsSync(join(figures, 'shenshen-actions', 'figure.json')), true), 'pack landed in figures/shenshen-actions');
check(() => assert.ok(a.library && a.library.endsWith('shenshen-library')), 'starter library copied: ' + a.library);
check(() => assert.equal(settings.libraryDir, a.library), 'libraryDir persisted into settings');
check(() => assert.equal(existsSync(join(a.library, 'actions', 'index.js')), true), 'library has actions/index.js');

/* 2. 第二次：幂等 */
const b = ensureStarter(ctx);
check(() => assert.equal(b.pack, false), 'second run does not re-seed the pack');
check(() => assert.equal(b.library, null), 'second run does not re-seed the library');

/* 3. 用户的包不被覆盖 */
writeFileSync(join(figures, 'shenshen-actions', 'figure.json'), JSON.stringify({ id: 'shenshen-actions', vocab: [{ id: 'mine' }] }));
ensureStarter(ctx);
const kept = JSON.parse(readFileSync(join(figures, 'shenshen-actions', 'figure.json'), 'utf8'));
check(() => assert.deepEqual(kept.vocab, [{ id: 'mine' }]), 'an existing pack is never overwritten');

/* 4. 用户已经指了动作库 → 不抢 */
rmSync(join(root, 'data2'), { recursive: true, force: true });
const mine = join(root, 'my-library');
mkdirSync(join(mine, 'actions'), { recursive: true });
const ctx2 = { ...ctx, libraryDir: () => mine, saveSettings: (p) => Object.assign(settings, p) };
const c = ensureStarter(ctx2);
check(() => assert.equal(c.library, null), 'a library the user already pointed at is left alone');

/* 5. 没有 starter 目录 → 安静跳过 */
const bare = fakePkg(join(root, 'bare'), { withStarter: false });
const d = ensureStarter({ ...ctx, pkgDir: bare, figuresDir: () => join(root, 'figures2'), libraryDir: () => '', saveSettings: () => {} });
check(() => assert.equal(d.skipped, 'no-starter') || assert.equal(d.pack, false), 'a package without assets/starter is a no-op');

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
