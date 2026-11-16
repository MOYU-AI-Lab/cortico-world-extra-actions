/**
 * 清单（figure.json）合规测试：宿主对清单是「一条不合格 → 整个包不加载」。
 *
 * 真实踩过的坑：给深深包加控制台配色预设时漏了 `pick`，宿主 packs.ts:330 直接
 * `presets 里有不合法的一项："teal"` → 整个包不加载 → 形象列表里没有深深，
 * 用户还以为可以再建一个（于是出现"重复创建"的错觉）。
 *
 *   node test_manifest.mjs
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkManifest } from './manifest-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(`${msg} → ${e.message}`); console.log('FAIL ' + msg); } };

const root = join(here, '_tmp-manifest');
rmSync(root, { recursive: true, force: true });

const writePack = (name, fig) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'figure.json'), JSON.stringify(fig, null, 2), 'utf8');
  writeFileSync(join(dir, 'figure.js'), 'export function createActionBody() {}', 'utf8');
  return dir;
};
const base = { manifest: 2, api: 2, id: 'shenshen-actions', name: { zh: '深深' }, about: { zh: 'x' }, entry: 'figure.js', export: 'createActionBody' };

/* ① 我们自带的 figure.json 必须合规 */
check(() => {
  const errs = checkManifest(join(here, '..', 'assets', 'starter', 'figure'));
  if (errs.length) throw new Error(errs.join('；'));
}, '插件自带 figure.json 符合宿主清单规则');

/* ② 没 pick 的预设会被抓出来（就是这次线上事故） */
check(() => {
  const dir = writePack('no-pick', { ...base, presets: [{ id: 'teal', console: { light: {}, dark: {} } }] });
  const errs = checkManifest(dir);
  if (!errs.some((e) => /preset "teal" 缺 pick/.test(e))) throw new Error('没识别出缺 pick：' + errs.join('；'));
}, '缺 pick 的预设被判为不合法（线上事故的复现）');

/* ③ pick 要覆盖每个 axis，且值必须是该 axis 的 option */
check(() => {
  const withAxis = {
    ...base,
    axes: [{ id: 'look', name: { zh: '样子' }, options: [{ id: 'a', name: { zh: 'A' } }, { id: 'b', name: { zh: 'B' } }] }],
  };
  const dir = writePack('pick-missing-axis', { ...withAxis, presets: [{ id: 'p1', pick: {} }] });
  const errs = checkManifest(dir);
  if (!errs.some((e) => /没给 axis "look"/.test(e))) throw new Error('没识别出 pick 缺 axis：' + errs.join('；'));

  const okDir = writePack('pick-ok', { ...withAxis, presets: [{ id: 'p1', pick: { look: 'a' } }] });
  const errs2 = checkManifest(okDir);
  if (errs2.length) throw new Error('合法预设被判错：' + errs2.join('；'));
}, 'pick 必须覆盖每个 axis 并取合法 option');

/* ④ console 调色板要齐全（light/dark × a,a2,on,t,c3,c4） */
check(() => {
  const dir = writePack('console-bad', { ...base, presets: [{ id: 'p2', pick: {}, console: { light: { a: '#000000' }, dark: {} } }] });
  const errs = checkManifest(dir);
  if (!errs.some((e) => /console\.light\.a2/.test(e))) throw new Error('没识别出配色字段缺失：' + errs.join('；'));
}, 'console 调色板缺字段会被抓出来');

/* ⑤ 合法包（带 console 预设）应当通过 */
check(() => {
  const preset = {
    id: 'teal', pick: {},
    name: { zh: '深深 · 青绿' }, accent: '#0b7a5a',
    console: {
      light: { a: '#0b7a5a', a2: '#0f9d76', on: '#ffffff', t: '#0b6b4f', c3: '#3f8f78', c4: '#8a8a90' },
      dark: { a: '#2fd3a0', a2: '#7fe6c2', on: '#062a20', t: '#8ae8c6', c3: '#5fbfa0', c4: '#9a9aa0' },
    },
  };
  const dir = writePack('good', { ...base, presets: [preset] });
  const errs = checkManifest(dir);
  if (errs.length) throw new Error(errs.join('；'));
}, '带 console 预设的合法包通过校验');

/* ⑥ 迁移会补 pick（老包里的坏预设） */
{
  const { ensureConsolePreset } = await import('../src/starter.js');
  const dir = writePack('migrate', { ...base, presets: [{ id: 'teal', console: { light: {}, dark: {} } }] });
  const before = checkManifest(dir);
  if (!before.some((e) => /缺 pick/.test(e))) throw new Error('夹具应该是坏的');
  ensureConsolePreset(dir);
  const after = checkManifest(dir);
  check(() => { if (after.some((e) => /缺 pick/.test(e))) throw new Error('迁移没补上 pick'); }, '迁移会给老预设补上 pick');
}

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
