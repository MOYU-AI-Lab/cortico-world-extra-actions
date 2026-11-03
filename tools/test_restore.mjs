/**
 * 「恢复空的形象包」的语义测试。
 *   node test_restore.mjs
 *
 * 覆盖：
 *   - 没有就建一个，且是「空」的（无 额外动作拓展、词表空）
 *   - 再来一次不会建第二个
 *   - 文件夹被改名但 id 相同时，只补缺的文件，不重复造
 *   - 同时存在多个同 id 包时，报出来、不动任何文件
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const { restorePack } = await import(pathToFileURL(join(here, '..', 'src', 'starter.js')).href);

const root = join(here, '_tmp-restore');
rmSync(root, { recursive: true, force: true });
const pkgDir = join(root, 'pkg');
const figures = join(root, 'figures');

/* 假的自带形象包 */
const fig = join(pkgDir, 'assets', 'starter', 'figure');
mkdirSync(join(fig, 'actions', 'core', 'state-idle'), { recursive: true });
writeFileSync(join(fig, 'figure.json'), JSON.stringify({ id: 'shenshen-actions', vocab: [{ id: 'x' }] }, null, 2));
writeFileSync(join(fig, 'figure.js'), 'export default 1;\n');
for (const s of ['state-idle', 'state-walk', 'state-drag', 'look-around']) {
  mkdirSync(join(fig, 'actions', 'core', s), { recursive: true });
  writeFileSync(join(fig, 'actions', 'core', s, 'action.json'), JSON.stringify({ id: s }));
}
mkdirSync(join(fig, '额外动作拓展', 'eat', 'x'), { recursive: true });
writeFileSync(join(fig, '额外动作拓展', 'eat', 'x', 'action.json'), '{}');

const o = { pkgDir, figuresDir: () => figures, log: () => {} };
const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(msg + ' → ' + e.message); console.log('FAIL ' + msg); } };

const a = restorePack(o);
check(() => assert.equal(a.created, true), 'creates a pack when none exists');
check(() => assert.equal(existsSync(join(figures, 'shenshen-actions', 'figure.js')), true), 'figure.js landed');
check(() => assert.equal(existsSync(join(figures, 'shenshen-actions', 'actions', 'core', 'state-idle', 'action.json')), true), 'the IDLE clip survives (待机呼吸必须在)');
check(() => assert.equal(existsSync(join(figures, 'shenshen-actions', 'actions', 'core', 'state-walk', 'action.json')), true), 'the walk clip survives');
check(() => assert.equal(existsSync(join(figures, 'shenshen-actions', 'actions', 'core', 'state-drag', 'action.json')), true), 'the drag clip survives');
check(() => assert.equal(existsSync(join(figures, 'shenshen-actions', 'actions', 'core', 'look-around', 'action.json')), true), 'the turn clip survives');
check(() => assert.equal(existsSync(join(figures, 'shenshen-actions', '额外动作拓展')), false), 'the created pack is empty (no 额外动作拓展)');
check(() => assert.equal(JSON.parse(readFileSync(join(figures, 'shenshen-actions', 'figure.json'), 'utf8')).vocab.length, 0), 'vocab is empty');
check(() => assert.equal(a.health.ok, true), 'health check passes right after creation');

const b = restorePack(o);
check(() => assert.equal(b.created, false), 'second call does not create another pack');
check(() => assert.equal(b.repaired, false), 'a healthy pack is left untouched');

/* 改名但 id 相同 */
rmSync(join(figures, 'shenshen-actions'), { recursive: true, force: true });
const renamed = join(figures, 'shenshen-copy');
mkdirSync(renamed, { recursive: true });
writeFileSync(join(renamed, 'figure.json'), JSON.stringify({ id: 'shenshen-actions' }));
const c = restorePack(o);
check(() => assert.equal(c.created, false), 'a renamed copy with the same id blocks a second pack');
check(() => assert.equal(c.repaired, true), 'the renamed copy got its missing files repaired');
check(() => assert.equal(existsSync(join(figures, 'shenshen-actions')), false), 'no duplicate folder was created');

/* 两个同 id */
const dup = join(figures, 'another-dup');
mkdirSync(dup, { recursive: true });
writeFileSync(join(dup, 'figure.json'), JSON.stringify({ id: 'shenshen-actions' }));
const d = restorePack(o);
check(() => assert.ok(Array.isArray(d.duplicates) && d.duplicates.length >= 1), 'duplicates are reported (' + (d.duplicates?.length ?? 0) + ')');
check(() => assert.equal(d.created, false), 'still no new pack created');

/* ---- 自选位置（0.3.4）：给 target 就按选的位置来 ---- */
const sub = join(figures, 'my-folder');
mkdirSync(sub, { recursive: true });
const e = restorePack({ ...o, target: sub, name: 'my-actions' });
check(() => assert.equal(e.created, true), 'explicit target creates the pack there');
check(() => assert.equal(e.path, sub), 'path is exactly the chosen folder');
check(() => assert.equal(JSON.parse(readFileSync(join(sub, 'figure.json'), 'utf8')).id, 'my-actions'), 'the custom name becomes the pack id');
check(() => assert.equal(JSON.parse(readFileSync(join(sub, 'figure.json'), 'utf8')).vocab.length, 0), 'the chosen one is empty too');
const e2 = restorePack({ ...o, target: sub, name: 'my-actions' });
check(() => assert.equal(e2.created, false), 'a second call on the same target creates nothing');
check(() => assert.equal(e2.repaired, false), 'a healthy target is left alone');

/* 选到根本身 → 在它下面按 name 建 */
const f = restorePack({ ...o, target: figures, name: 'second-pack' });
check(() => assert.equal(f.created, true), 'picking the root itself creates a pack under it');
check(() => assert.equal(f.path, join(figures, 'second-pack')), 'landed at <root>/<name>');

/* 选到根外面 → 明确拒绝，别写出桌宠看不到的包 */
const outside = join(root, 'outside');
mkdirSync(outside, { recursive: true });
let rejected = null;
try { restorePack({ ...o, target: outside, name: 'nope' }); } catch (err) { rejected = err; }
check(() => assert.ok(rejected && /不在任何形象包目录/.test(rejected.message)), 'a target outside every root is refused');
check(() => assert.equal(existsSync(join(outside, 'nope')), false), 'nothing was written outside the roots');

/* ---- 多个形象包根（COOPANION_PACK_ROOTS）---- */
const otherRoot = join(root, 'workshop');
mkdirSync(otherRoot, { recursive: true });
const g = restorePack({ ...o, roots: () => [figures, otherRoot], target: otherRoot, name: 'from-workshop' });
check(() => assert.equal(g.created, true), 'a pack can be created in a second root');
check(() => assert.equal(g.root, otherRoot), 'the reported root is the one it landed in');
check(() => assert.equal(existsSync(join(otherRoot, 'from-workshop', 'figure.js')), true), 'the player file is there');

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
