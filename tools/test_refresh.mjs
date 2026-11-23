/**
 * 「更新走/跑动画」按钮的后台逻辑（world.refreshClips）走查：不连网，fetch 用本地修复包冒充。
 *
 * 覆盖：
 *  1. 旧包（有损 walk/crab + 旧播放器）→ 下载并替换成有损修复版 + 播放器升级；
 *  2. 已是最新的包 → 不下载、changed=0；
 *  3. 替换后文件与修复包 sha256 一致、旧播放器有备份。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const FIX_DIR = 'E:\\DSH-PET\\形象包\\修复包-0.3.36';
const OLD_WALK = 'E:\\DSH-PET\\形象包\\深深-动作库-高清\\actions\\core\\state-walk\\anim.webp';
const OLD_CRAB = 'E:\\DSH-PET\\形象包\\深深-动作库-高清\\actions\\core\\crab-walk\\anim.webp';

process.env.COOPANION_PET_OFF = '1';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-refresh-'));
const figures = path.join(tmp, 'figures');
const pack = path.join(figures, 'test-pack');
const core = path.join(pack, 'actions', 'core');
fs.mkdirSync(path.join(core, 'state-walk'), { recursive: true });
fs.mkdirSync(path.join(core, 'crab-walk'), { recursive: true });
fs.writeFileSync(path.join(pack, 'figure.json'), JSON.stringify({ manifest: 2, api: 2, id: 'test-pack', entry: 'figure.js' }));
// 旧播放器：长得像 createActionBody 家族（入口含「额外动作拓展」），但不是插件自带的那份
fs.writeFileSync(path.join(pack, 'figure.js'), '// 老播放器\nexport default { 额外动作拓展: 1 };\n');
fs.copyFileSync(OLD_WALK, path.join(core, 'state-walk', 'anim.webp'));
fs.copyFileSync(OLD_CRAB, path.join(core, 'crab-walk', 'anim.webp'));

/* fetch 冒充：URL 末段 → 本地修复包文件 */
const calls = [];
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  const file = path.join(FIX_DIR, name);
  if (!fs.existsSync(file)) return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
  calls.push(name);
  const buf = fs.readFileSync(file);
  return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

const { ExtraActionsWorld } = await import('../src/world.js');
const world = new ExtraActionsWorld({ ctx: { dataDir: path.join(tmp, 'data'), cfg: { figuresDir: figures }, persist: () => {} } });
const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const FIX = {
  walk: 'c325877ee74e9f3e87388e875afa1b344c75b483af6dbd77760da2ec3393c0dc',
  crab: '4282b19bf37d59ccde5973b7bb9bb7602ab1e7f475569d996f672c66c13722db',
};

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

const r1 = await world.refreshClips('test-pack');
ok(r1.changed === 3 && r1.walk === 'lossy' && r1.crab === 'lossy' && r1.player === 'updated', `第一次：走/跑/播放器 都更新了 (changed=${r1.changed})`);
ok(calls.length === 2 && calls.includes('walk-fix-lossy.webp') && calls.includes('crab-fix-lossy.webp'), '只下载了有损版两个文件');
ok(sha(path.join(core, 'state-walk', 'anim.webp')) === FIX.walk, 'state-walk 已换成修复版（sha256 一致）');
ok(sha(path.join(core, 'crab-walk', 'anim.webp')) === FIX.crab, 'crab-walk 已换成修复版（sha256 一致）');
ok(fs.readFileSync(path.join(pack, 'figure.js'), 'utf8').includes('RUN_HOLD_MS'), '播放器已升级（含先迈一步再跑）');
ok(fs.existsSync(path.join(pack, 'figure.js.bak-播放器')), '旧播放器有备份');

const r2 = await world.refreshClips('test-pack');
ok(r2.changed === 0, `第二次：changed=0（已是最新）`);
ok(calls.length === 2, '第二次没有再下载');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} 条失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
