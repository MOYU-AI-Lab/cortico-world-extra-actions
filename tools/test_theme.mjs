/**
 * 控制台配色（theme）相关的回归测试。
 *
 * 背景：宿主 core/console-theme.ts 的 followPetLook() 规则是 ——
 *   selectedId 是 mint（默认）或任何一个 coo-fig-* 时，配色「跟着形象走」；
 *   而 schemeForSkin() 对**没有 console 预设**的形象包一律返回 mint。
 * 我们的包之前 presets 是空的，所以切到深深就会把配色钉回默认（用户看到的"改了还是掉"）。
 *
 * 这里验证：给深深包补上 console 预设之后，宿主算出来的就是深深自己的配色，而不是 mint。
 *   node test_theme.mjs
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const S = await import(pathToFileURL(join(here, '..', 'src', 'starter.js')).href);

const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(`${msg} → ${e.message}`); console.log('FAIL ' + msg); } };

const root = join(here, '_tmp-theme');
rmSync(root, { recursive: true, force: true });

const mk = (name, id, presets) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'figure.json'), JSON.stringify({ manifest: 2, api: 2, id, entry: 'figure.js', presets }, null, 2), 'utf8');
  writeFileSync(join(dir, 'figure.js'), "const X = '额外动作拓展';", 'utf8');
  return dir;
};

/* 复刻宿主 console-theme.ts 的两段关键逻辑 */
const COO = 'mint';
const isFigureScheme = (id) => id.startsWith('coo-whale-') || id.startsWith('coo-fig-');
const schemeId = (figure, preset) => (figure === 'whale' ? `coo-whale-${preset}` : `coo-fig-${figure}-${preset}`);
function schemeForSkin(skin, packs) {
  const pack = packs.find((p) => p.id === skin?.figure);
  const presets = pack?.manifest?.presets?.filter?.((p) => p.console) ?? [];
  if (!pack || !presets.length) return COO;
  return schemeId(pack.id, presets[0].id);
}

const ours = mk('shenshen', 'shenshen-actions', []);
const foreign = mk('other', 'someone-else', []);

/* ① 迁移前：宿主会把它算成 mint */
const before = JSON.parse(readFileSync(join(ours, 'figure.json'), 'utf8'));
check(() => {
  const id = schemeForSkin({ figure: 'shenshen-actions', scheme: '' }, [{ id: 'shenshen-actions', manifest: before }]);
  if (id !== COO) throw new Error('预期是 mint，实际 ' + id);
}, '迁移前：没有 console 预设时宿主回落 mint（复现 bug）');

/* ② 迁移：只给自己这个包加 */
const r1 = S.ensureConsolePreset(ours);
check(() => { if (!r1.changed) throw new Error('没有加预设'); }, '深深包被补上 console 预设');
check(() => {
  const j = JSON.parse(readFileSync(join(ours, 'figure.json'), 'utf8'));
  const p = j.presets.find((x) => x.console);
  if (!p) throw new Error('没有带 console 的预设');
  for (const k of ['a', 'a2', 'on', 't', 'c3', 'c4']) {
    if (!p.console.light?.[k] || !p.console.dark?.[k]) throw new Error('缺字段 ' + k);
  }
}, '预设结构符合宿主 figureSchemes() 的期望（light/dark × a,a2,on,t,c3,c4）');

/* ③ 迁移后：宿主算出来的是深深自己的配色 */
check(() => {
  const j = JSON.parse(readFileSync(join(ours, 'figure.json'), 'utf8'));
  const id = schemeForSkin({ figure: 'shenshen-actions', scheme: '' }, [{ id: 'shenshen-actions', manifest: j }]);
  if (!id.startsWith('coo-fig-shenshen-actions')) throw new Error('实际 ' + id);
}, '迁移后：切到深深得到「深深 · 青绿」，不再是 mint');

/* ④ 幂等 */
const r2 = S.ensureConsolePreset(ours);
check(() => { if (r2.changed) throw new Error('第二次又写了'); }, '重复调用不再写盘');

/* ⑤ 别人的包一律不碰 */
const r3 = S.ensureConsolePreset(foreign);
check(() => { if (r3.changed) throw new Error('动了别人的包'); }, '别人的形象包不动');
check(() => {
  const j = JSON.parse(readFileSync(join(foreign, 'figure.json'), 'utf8'));
  if (j.presets.length) throw new Error('别人的包被加了预设');
}, "别人的包 presets 仍是空的");

/* ⑥ 已经有 console 预设的包不覆盖 */
const has = mk('has', 'shenshen-actions', [{ id: 'keep-me', console: { light: {}, dark: {} } }]);
S.ensureConsolePreset(has);
check(() => {
  const j = JSON.parse(readFileSync(join(has, 'figure.json'), 'utf8'));
  if (j.presets.length !== 1 || j.presets[0].id !== 'keep-me') throw new Error('覆盖了已有预设');
}, '已有 console 预设时不覆盖');

/* ⑦ 自带素材也要带预设（新装用户第一次就是对的） */
check(() => {
  const j = JSON.parse(readFileSync(join(here, '..', 'assets', 'starter', 'figure', 'figure.json'), 'utf8'));
  if (!j.presets?.some((p) => p.console)) throw new Error('自带 figure.json 没有 console 预设');
}, '插件自带 figure.json 带 console 预设');

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
