/**
 * 形象包多根发现 + 「自动寻找动作库」的测试。
 *   node test_locate.mjs
 *
 * 覆盖（全部用临时目录，不碰本机真实数据、不写死任何路径）：
 *   - COOPANION_PACK_ROOTS 里的额外根会被算进 figureRoots()
 *   - packDirs() 跨根收包，id 以 figure.json 为准
 *   - findLibraries() 找得到：当前设置的库、dataDir 自带库、含 actions/ 的形象包、
 *     用户目录里名字像「动作库」的目录，以及插件内置示例库
 *   - 不像库的目录、重复路径都被正确排除 / 去重
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '_tmp-locate');
rmSync(root, { recursive: true, force: true });

const figures = join(root, 'figures');
const workshop = join(root, 'workshop');
const dataDir = join(root, 'data');
const library = join(root, 'lib-current');
const home = join(root, 'home');
const desktopLib = join(home, 'Desktop', '深深-动作库');

const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(msg + ' → ' + e.message); console.log('FAIL ' + msg); } };

/** 造一个模块：action.json + 两帧（帧内容不重要，扫库只读 action.json）。 */
function module(dir, meta) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'f_0001.webp'), 'x');
  writeFileSync(join(dir, 'f_0002.webp'), 'x');
  writeFileSync(join(dir, 'action.json'), JSON.stringify(meta));
}

/** 造一个"像动作库"的目录。 */
function makeLibrary(dir, ids) {
  mkdirSync(join(dir, 'actions'), { recursive: true });
  for (const [i, id] of ids.entries()) {
    module(join(dir, 'actions', i === 0 ? 'core' : 'eat', id), { id, category: i === 0 ? 'core' : 'eat', frames: 2, fps: 24, seconds: 0.083 });
  }
}

/** 造一个形象包目录：figure.json 认 id，可选带 actions/（带 actions/ 的包也算库）。 */
function makePack(dir, id, { withActions = false } = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'figure.json'), JSON.stringify({ manifest: 2, api: 2, id, name: { zh: id } }));
  writeFileSync(join(dir, 'figure.js'), 'export function createActionBody() {}\n');
  if (withActions) makeLibrary(dir, ['pack-action']);
}

makeLibrary(library, ['a-one', 'a-two', 'a-three']);
makeLibrary(desktopLib, ['d-one', 'd-two']);
makePack(join(figures, 'some-pack'), 'some-pack');
makePack(join(figures, 'pack-with-actions'), 'pack-with-actions', { withActions: true });
makePack(join(workshop, 'workshop-pack'), 'workshop-pack');
mkdirSync(join(figures, 'not-a-pack'), { recursive: true });
mkdirSync(dataDir, { recursive: true });
makeLibrary(join(dataDir, 'shenshen-library'), ['bundled-one']);

/* 环境：额外根 + 假的家目录（findLibraries 会看 USERPROFILE 下的桌面等） */
process.env.COOPANION_PACK_ROOTS = [workshop].join(delimiter);
process.env.USERPROFILE = home;
process.env.HOME = home;

const { ExtraActionsWorld } = await import(pathToFileURL(join(here, '..', 'src', 'world.js')).href);

const ctx = {
  dataDir,
  botDir: '',
  cfg: { libraryDir: library, figuresDir: figures },
  persist() {},
  packageDir: join(here, '..'),
  repoRoot: here,
};
const world = new ExtraActionsWorld({ ctx });

/* ---- 1. 多根 ---- */
const roots = world.figureRoots();
check(() => assert.equal(roots.length, 2), 'figureRoots() has the primary root plus COOPANION_PACK_ROOTS (' + roots.length + ')');
check(() => assert.equal(roots[0], figures), 'the primary root comes first');
check(() => assert.ok(roots.some((r) => r === workshop)), 'the extra root is included');

/* ---- 2. 跨根收包 ---- */
const packs = world.packDirs();
check(() => assert.ok(packs.has('some-pack')), 'finds a pack in the primary root');
check(() => assert.ok(packs.has('workshop-pack')), 'finds a pack in the extra root');
check(() => assert.equal(packs.get('workshop-pack')?.dir, join(workshop, 'workshop-pack')), 'reports the dir it actually lives in');
check(() => assert.equal(packs.has('not-a-pack'), false), 'a folder without figure.json is not a pack');
check(() => assert.equal(packs.get('some-pack')?.fig.id, 'some-pack'), 'the id comes from figure.json');

/* ---- 3. 自动寻找动作库 ---- */
const r = world.findLibraries();
const dirs = r.libraries.map((l) => l.dir);
check(() => assert.ok(r.count >= 4), 'several candidates found (' + r.count + ')');
check(() => assert.ok(dirs.includes(library)), 'the configured library is a candidate');
check(() => assert.ok(r.libraries.find((l) => l.dir === library)?.current === true), 'the configured one is marked current');
check(() => assert.ok(dirs.includes(join(dataDir, 'shenshen-library'))), 'the bundled library under dataDir is a candidate');
check(() => assert.ok(dirs.includes(join(figures, 'pack-with-actions'))), 'a figure pack with actions/ counts as a library');
check(() => assert.ok(dirs.includes(desktopLib)), 'a folder named like an action library on the desktop is a candidate');
// 插件包里有没有 assets/starter 取决于是 npm 发布包（带帧）还是 git 仓库（不追踪帧），两种都要能跑
const builtinSample = join(here, '..', 'assets', 'starter', 'library');
check(() => assert.equal(dirs.includes(builtinSample), existsSync(builtinSample)), 'the built-in sample library is offered exactly when the package ships one');
check(() => assert.equal(dirs.includes(join(figures, 'some-pack')), false), 'a pack without actions/ is not a library');
check(() => assert.equal(new Set(dirs).size, dirs.length), 'candidates are de-duplicated');
check(() => assert.ok(r.libraries.find((l) => l.dir === library)?.count === 3), 'module count is right (' + r.libraries.find((l) => l.dir === library)?.count + ')');
check(() => assert.ok((r.libraries.find((l) => l.dir === library)?.categories ?? []).includes('eat')), 'categories are reported');

/* ---- 4. 环境里没有额外根时也不炸 ---- */
delete process.env.COOPANION_PACK_ROOTS;
const solo = new ExtraActionsWorld({ ctx });
check(() => assert.equal(solo.figureRoots().length, 1), 'no extra roots = just the primary one');
check(() => assert.ok(solo.findLibraries().count >= 1), 'findLibraries still works without extra roots');

rmSync(root, { recursive: true, force: true });
/* 选到"装着动作库的上一层"时，setLibrary 要能自己往下找 */
{
  const root = join(here, '_tmp-descend');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, '下载', '深深-动作库', 'actions', 'eat', 'x'), { recursive: true });
  writeFileSync(join(root, '下载', '深深-动作库', 'actions', 'eat', 'x', 'action.json'),
    JSON.stringify({ id: 'x', word: 'x', category: 'eat', zh: '测试', frames: 2, seconds: 1 }));
  const ctx = { dataDir: join(root, 'data'), botDir: '', cfg: {}, persist: (p) => Object.assign(ctx.cfg, p), packageDir: join(here, '..'), repoRoot: here };
  const w = new (await import(pathToFileURL(join(here, '..', 'src', 'world.js')).href)).ExtraActionsWorld({ ctx });
  const r = await w.invoke('picker', 'set-library', [join(root, '下载')]);
  check(() => { if (!r.moved) throw new Error('没有自动下钻'); }, '选到上一级会自动定位到里面的动作库');
  check(() => { if (!r.libraryDir.endsWith('深深-动作库')) throw new Error('定位错了：' + r.libraryDir); }, '定位到 <上一级>/深深-动作库');
  rmSync(root, { recursive: true, force: true });
}
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
