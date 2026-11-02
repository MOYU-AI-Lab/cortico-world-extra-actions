/**
 * 清单收敛的回归测试：库就是真相，action.json 说了算，index.js 可重建。
 *   node test_catalog.mjs
 *
 * 覆盖：
 *   - 面板清单来自磁盘扫描（不是打包时的 catalog.json），缩略图从模块补
 *   - 改一个 action.json（frames）→ 清单立刻跟着变，不用碰 index.js
 *   - 导入新动作 → index.js 由 action.json 重新生成（不是追加）
 *   - reindex 幂等：第二次跑报告"无变化"
 *   - 删掉模块目录 → 清单里也不再有它
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const LIB_REAL = process.env.SHENSHEN_LIBRARY || 'C:/Users/11436/Desktop/深深-动作库';
const root = join(here, '_tmp-catalog');
rmSync(root, { recursive: true, force: true });
const lib = join(root, 'lib');
const dataDir = join(root, 'data');
mkdirSync(join(lib, 'actions'), { recursive: true });
mkdirSync(dataDir, { recursive: true });

/** 从真库里搬 3 个模块（含 action.json / preview）当夹具。 */
const picks = ['core/state-idle', 'core/look-around', 'eat/eat-dumplings'];
for (const rel of picks) {
  const from = join(LIB_REAL, 'actions', ...rel.split('/'));
  const to = join(lib, 'actions', ...rel.split('/'));
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) copyFileSync(join(from, f), join(to, f));
}
writeFileSync(join(lib, 'actions', 'index.js'), 'export default [];\n');
writeFileSync(join(lib, 'figure.json'), JSON.stringify({ id: 'x', vocab: [] }));

const { rebuildIndex, scanLibrary } = await import(pathToFileURL(join(here, '..', 'src', 'importer.js')).href);
const { ExtraActionsWorld } = await import(pathToFileURL(join(here, '..', 'src', 'world.js')).href);

const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(msg + ' → ' + e.message); console.log('FAIL ' + msg); } };

const ctx = {
  dataDir,
  botDir: '',
  cfg: { libraryDir: lib, figuresDir: join(root, 'figures') },
  persist() {},
  packageDir: join(here, '..'),
  repoRoot: here,
};
const world = new ExtraActionsWorld({ ctx });

/* ---- 1. 清单来自磁盘 ---- */
let cat = world.mergedCatalog();
check(() => assert.equal(cat.count, 3), 'catalog = 3 modules scanned from disk (' + cat.count + ')');
check(() => assert.deepEqual(cat.actions.map((a) => a.id).sort(), ['eat-dumplings', 'look-around', 'state-idle']), 'exactly the modules on disk');
const drag = cat.actions.find((a) => a.id === 'state-idle');
check(() => assert.ok(drag.roles.includes('idle')), 'roles come from action.json');
check(() => assert.ok(drag.thumb && drag.thumb.startsWith('data:image/webp;base64')), 'thumbnail filled in (bundle or preview.webp)');

/* ---- 2. index.js 只是投影：改 action.json 就够 ---- */
const mod = join(lib, 'actions', 'eat', 'eat-dumplings');
const meta = JSON.parse(readFileSync(join(mod, 'action.json'), 'utf8'));
meta.frames = 999;
writeFileSync(join(mod, 'action.json'), JSON.stringify(meta));
world.bustCatalog();
cat = world.mergedCatalog();
check(() => assert.equal(cat.actions.find((a) => a.id === 'eat-dumplings').frames, 999), 'editing action.json changes the catalog without touching index.js');
const idxText = readFileSync(join(lib, 'actions', 'index.js'), 'utf8');
check(() => assert.equal(idxText, 'export default [];\n'), 'index.js was not needed for that');
meta.frames = 241;
writeFileSync(join(mod, 'action.json'), JSON.stringify(meta));
world.bustCatalog();

/* ---- 3. 导入 → index.js 由 action.json 重建 ---- */
const src = join(root, 'incoming');
mkdirSync(join(src, 'wave-hi'), { recursive: true });
for (let i = 1; i <= 3; i++) copyFileSync(join(mod, `f_${String(i).padStart(4, '0')}.webp`), join(src, 'wave-hi', `f_${String(i).padStart(4, '0')}.webp`));
const added = await world.addActions(src);
check(() => assert.equal(added.added.length, 1), 'import added one module');
const idx2 = readFileSync(join(lib, 'actions', 'index.js'), 'utf8');
check(() => assert.equal((idx2.match(/\{ id:/g) || []).length, 4), 'index.js regenerated with 4 entries');
const parsed = (await import(pathToFileURL(join(lib, 'actions', 'index.js')).href + '?v=' + Date.now())).default;
check(() => assert.ok(parsed.some((e) => e.id === 'wave-hi' && e.clip === 'actions/extra/wave-hi')), 'generated line points at the right clip');

/* ---- 4. reindex 幂等 ---- */
const r1 = rebuildIndex(lib);
const r2 = rebuildIndex(lib);
check(() => assert.equal(r2.changed, false), 'reindex is idempotent (' + r1.changed + ' then ' + r2.changed + ')');
check(() => assert.equal(r2.count, 4), '4 modules after import');

/* ---- 5. 删目录 → 清单里也没有 ---- */
rmSync(join(lib, 'actions', 'extra', 'wave-hi'), { recursive: true });
rebuildIndex(lib);
world.bustCatalog();
check(() => assert.equal(world.mergedCatalog().count, 3), 'deleting the module dir removes it from the catalog');
check(() => assert.equal(scanLibrary(lib).size, 3), 'scanLibrary agrees');

/* ---- 6. 库不可用 → 退回内置清单，不崩 ---- */
const offline = new ExtraActionsWorld({ ctx: { ...ctx, cfg: { libraryDir: join(root, 'nope') } } });
check(() => assert.ok(offline.mergedCatalog().count > 0), 'falls back to the bundled catalog when the library is gone');
check(() => assert.equal(offline.mergedCatalog().count, offline.bundle.count), 'fallback is the bundled list');

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
