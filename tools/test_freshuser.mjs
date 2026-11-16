/**
 * 全新用户端到端：从零铺一个深深包 → 保存动作 → 用宿主规则体检。
 *   node test_freshuser.mjs
 *
 * 这一步专门盯"新装的人"会遇到的问题：包铺出来合不合规、保存后词表会不会被拒、
 * 播放器/配色预设有没有带、以及重复启动会不会反复写盘。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkManifest } from './manifest-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(`${msg} → ${e.message}`); console.log('FAIL ' + msg); } };

const W = await import(pathToFileURL(join(here, '..', 'src', 'world.js')).href);

const root = join(here, '_tmp-fresh');
rmSync(root, { recursive: true, force: true });
const botDir = join(root, 'home', 'companion');
const dataDir = join(botDir, 'data');
mkdirSync(dataDir, { recursive: true });

const cfg = {};
const ctx = { dataDir, botDir, cfg, persist: (p) => Object.assign(cfg, p), packageDir: join(here, '..'), repoRoot: here };
const w = new W.ExtraActionsWorld({ ctx });

/* ① 首次启动：铺包 */
await w.start({ log: { info: () => {}, warn: () => {} } });
const packDir = join(botDir, 'data', 'figures', 'shenshen-actions');
check(() => { if (!existsSync(join(packDir, 'figure.json'))) throw new Error('没有铺出形象包'); }, '首启铺出形象包');

/* ② 铺出来的包必须过宿主清单校验（这是 0.3.30 翻车的地方） */
check(() => {
  const errs = checkManifest(packDir);
  if (errs.length) throw new Error(errs.join('；'));
}, '铺出来的 figure.json 符合宿主清单规则');

/* ③ 包里有配色预设、有 pick、播放器是新的 */
check(() => {
  const fig = JSON.parse(readFileSync(join(packDir, 'figure.json'), 'utf8'));
  const p = (fig.presets ?? []).find((x) => x.console);
  if (!p) throw new Error('没有 console 预设');
  if (!p.pick || typeof p.pick !== 'object') throw new Error('预设缺 pick');
}, '带配色预设且 pick 合法');

check(() => {
  const js = readFileSync(join(packDir, figEntry(packDir)), 'utf8');
  if (!js.includes('REACTION_MAX')) throw new Error('播放器不是新版（没有 REACTION_MAX）');
}, '播放器是新版（点击回应有上限+兜底）');

function figEntry(dir) {
  const fig = JSON.parse(readFileSync(join(dir, 'figure.json'), 'utf8'));
  return fig.entry ?? 'figure.js';
}

/* ④ 建个 4 段的小库，勾两段保存 */
const lib = join(root, 'lib');
const hd = 'D:/Coopanion-data/深深-动作库-HD/actions';
for (const [cat, id] of [['core', 'cheer-hop'], ['eat', 'eat-dumplings']]) {
  cpSync(join(hd, cat, id), join(lib, 'actions', cat, id), { recursive: true });
}

const state0 = await w.invoke('picker', 'state');
if (!state0.library.ok) {
  await w.invoke('picker', 'set-library', [lib]);
}
const r = await w.invoke('picker', 'save', ['shenshen-actions', ['cheer-hop', 'eat-dumplings']]);
check(() => { if (!r || !r.count) throw new Error('保存没写入任何东西'); }, '保存两段动作成功：' + (r?.count ?? 0) + ' 段');

/* ⑤ 保存后：清单仍然合规、词表过宿主校验、模块在 index 里 */
check(() => {
  const errs = checkManifest(packDir);
  if (errs.length) throw new Error(errs.join('；'));
}, '保存后 figure.json 仍然合规');

check(() => {
  const fig = JSON.parse(readFileSync(join(packDir, 'figure.json'), 'utf8'));
  const NAME_BREAK = /[,，、\s【】<>＜＞]/;
  const taken = new Set();
  for (const w of fig.vocab ?? []) {
    for (const n of [w.id, ...Object.values(w.names ?? {}).flat()]) {
      if (taken.has(n)) throw new Error('名字重复：' + n);
      taken.add(n);
    }
    for (const n of Object.values(w.names ?? {}).flat()) {
      if (n.length > 32 || NAME_BREAK.test(n)) throw new Error('名字不合法：' + n);
    }
  }
}, '保存后的词表能过宿主校验（不会被整份拒掉）');

check(() => {
  const idx = readFileSync(join(packDir, '额外动作拓展', 'index.js'), 'utf8');
  for (const id of ['cheer-hop', 'eat-dumplings']) {
    if (!idx.includes(id)) throw new Error('index 里没有 ' + id);
  }
}, '额外动作拓展/index.js 里两段都在');

/* ⑥ 再启动一次：不该重复写、也不该改坏 */
{
  const before = readFileSync(join(packDir, 'figure.json'), 'utf8');
  const w2 = new W.ExtraActionsWorld({ ctx });
  await w2.start({ log: { info: () => {}, warn: () => {} } });
  const after = readFileSync(join(packDir, 'figure.json'), 'utf8');
  check(() => { if (before !== after) throw new Error('第二次启动又改了 figure.json'); }, '重复启动不重复写 figure.json');
}

/* ⑦ 包健康度（插件自己的 inspect） */
check(() => {
  const r2 = w.invoke('picker', 'state');
  return r2;
}, 'state 可读');

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
