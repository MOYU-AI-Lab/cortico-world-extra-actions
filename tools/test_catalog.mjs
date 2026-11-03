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
const root = join(here, '_tmp-catalog');
rmSync(root, { recursive: true, force: true });
const lib = join(root, 'lib');
const dataDir = join(root, 'data');
mkdirSync(join(lib, 'actions'), { recursive: true });
mkdirSync(dataDir, { recursive: true });

/** 造一张"头部合法"的 webp（扫库/缩略图都只关心这是个 webp）。 */
function fakeWebp(w = 640, h = 360) {
  const buf = Buffer.alloc(40);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(32, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8L', 12, 'ascii');
  buf.writeUInt32LE(4, 16);
  buf[20] = 0x2f;
  buf.writeUInt32LE(((((h - 1) << 14) | (w - 1)) >>> 0), 21);
  return buf;
}
const FRAME = fakeWebp();

/** 造一个模块目录：3 帧 + preview.webp + action.json（全部合成，不依赖本机素材库）。 */
function makeModule(dir, meta) {
  mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= 3; i++) writeFileSync(join(dir, `f_${String(i).padStart(4, '0')}.webp`), FRAME);
  writeFileSync(join(dir, 'preview.webp'), FRAME);
  writeFileSync(join(dir, 'action.json'), JSON.stringify({
    category: 'core', frames: 3, fps: 24, seconds: 0.125, word: null, roles: [], ...meta,
  }, null, 2));
  return dir;
}

makeModule(join(lib, 'actions', 'core', 'state-idle'), { id: 'state-idle', zh: '待机', roles: ['idle'] });
makeModule(join(lib, 'actions', 'core', 'look-around'), { id: 'look-around', zh: '东张西望', roles: ['turn'] });
makeModule(join(lib, 'actions', 'eat', 'eat-dumplings'), { id: 'eat-dumplings', zh: '吃饺子', word: 'eat-dumplings' });
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

/* ---- 1. 清单 = 内置 105 条固定目录 ∪ 磁盘实际有的模块（0.3.10 起） ---- */
let cat = world.mergedCatalog();
check(() => assert.ok(cat.count >= 105), 'catalog keeps the built-in rows (count=' + cat.count + ')');
check(() => assert.equal(cat.present, 3), 'only the 3 on-disk modules are present (' + cat.present + ')');
check(() => assert.equal(cat.missing, cat.count - 3), 'the rest are reported missing (' + cat.missing + ')');
check(() => assert.ok(['eat-dumplings', 'look-around', 'state-idle'].every((id) => cat.actions.find((x) => x.id === id)?.present === true)), 'the 3 on-disk modules are marked present');
const absent = cat.actions.find((a) => a.present === false);
check(() => assert.ok(absent && absent.id), 'a built-in row missing from disk is still listed');
check(() => assert.equal(absent.dir, `actions/${absent.category}/${absent.id}`), 'an absent row still carries its fixed dir: ' + absent.dir);
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

/* ---- 5. 删目录 → 导入的那一行从清单里消失，内置 105 条仍在 ---- */
rmSync(join(lib, 'actions', 'extra', 'wave-hi'), { recursive: true });
rebuildIndex(lib);
world.bustCatalog();
check(() => assert.equal(world.mergedCatalog().actions.find((a) => a.id === 'wave-hi'), undefined), 'deleting the module dir drops the imported row');
check(() => assert.equal(scanLibrary(lib).size, 3), 'scanLibrary agrees');

/* ---- 6. 库不可用 → 退回内置清单，不崩 ---- */
const offline = new ExtraActionsWorld({ ctx: { ...ctx, cfg: { libraryDir: join(root, 'nope') } } });
check(() => assert.ok(offline.mergedCatalog().count > 0), 'falls back to the bundled catalog when the library is gone');
check(() => assert.equal(offline.mergedCatalog().count, offline.bundle.count), 'fallback is the bundled list');

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
