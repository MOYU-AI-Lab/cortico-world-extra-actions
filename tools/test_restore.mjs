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

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
