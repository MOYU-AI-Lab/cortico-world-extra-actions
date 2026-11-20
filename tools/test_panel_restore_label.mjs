/**
 * 面板「创建 / 修复深深形象包」的回归测试。
 *
 * 背景：以前只有两态（有包 → 修复 / 没包 → 建立空的角色包），而插件首次启动就会铺一个**空壳**，
 * 于是新手装完第一眼看到的是「修复深深形象包」，像是有东西已经坏了。
 * 现在按「有没有真的建起来」判：
 *   - 没有深深包，或只有空壳（没额外动作、清单也没毛病）→ 创建深深形象包
 *   - 写过动作，或 figure.json 有宿主不认的地方 → 修复深深形象包
 * 而且「修复」不再弹目录选择器，直接对现成那个包动手。
 *
 * 做法：把 dist/webui.js 里的 `restoreAction()` 原文抠出来，喂假 state 直接跑
 * （面板不是 ES module，整份 eval 需要 DOM，所以只测这个纯函数 + 关键结构）。
 *
 *   node tools/test_panel_restore_label.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'dist', 'webui.js'), 'utf8');

const fails = [];
const ok = (m) => console.log('ok   ' + m);
const bad = (m) => { fails.push(m); console.log('FAIL ' + m); };

/** 从 `function name(` 开始按花括号配平，抠出整个函数源码。 */
function sliceFunction(text, header) {
  const start = text.indexOf(header);
  if (start < 0) return null;
  let i = text.indexOf('{', start);
  if (i < 0) return null;
  let depth = 0;
  let mode = null;
  for (; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && next === '/') { mode = null; i++; } continue; }
    if (mode === 'str' || mode === 'tpl') {
      if (c === '\\') { i++; continue; }
      if ((mode === 'str' && (c === "'" || c === '"')) || (mode === 'tpl' && c === '`')) mode = null;
      continue;
    }
    if (c === '/' && next === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && next === '*') { mode = 'block'; i++; continue; }
    if (c === "'" || c === '"') { mode = 'str'; continue; }
    if (c === '`') { mode = 'tpl'; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/* ---------- 1. restoreAction 的三态判定 ---------- */
const fnSrc = sliceFunction(src, 'function restoreAction()');
if (!fnSrc) bad('dist/webui.js 里找不到 restoreAction()');
else {
  // 只拿函数体，state 通过参数注入（原函数从闭包读 state，这里等价）。
  const factory = new Function('state', `${fnSrc}\nreturn restoreAction();`);
  const cases = [
    { name: '完全没有深深包 → 创建', state: { figures: [{ id: 'shenshen-hd', extra: { count: 5 } }] }, mode: 'create', label: '创建深深形象包' },
    { name: 'state 里没有 figures → 创建', state: {}, mode: 'create', label: '创建深深形象包' },
    { name: '只有空壳（没额外动作、清单没毛病）→ 创建', state: { figures: [{ id: 'shenshen-actions', dir: 'D:/f/shenshen-actions', problem: null, extra: { count: 0 } }] }, mode: 'create', label: '创建深深形象包' },
    { name: '空壳但清单有毛病 → 修复', state: { figures: [{ id: 'shenshen-actions', dir: 'D:/f/shenshen-actions', problem: '缺 name', extra: { count: 0 } }] }, mode: 'repair', label: '修复深深形象包' },
    { name: '写过动作 → 修复', state: { figures: [{ id: 'shenshen-actions', dir: 'D:/f/shenshen-actions', problem: null, extra: { count: 12 } }] }, mode: 'repair', label: '修复深深形象包' },
    { name: 'extra 字段缺失时当成空壳 → 创建', state: { figures: [{ id: 'shenshen-actions', dir: 'D:/f/shenshen-actions' }] }, mode: 'create', label: '创建深深形象包' },
  ];
  for (const c of cases) {
    const got = factory(c.state);
    if (got.mode !== c.mode || got.label !== c.label) bad(`${c.name}：得到 ${got.mode}/${got.label}，期望 ${c.mode}/${c.label}`);
    else ok(c.name);
  }
  // 修复时要把现有包的绝对路径带出来（点击处理不再弹目录，靠这个路径）
  const got = factory({ figures: [{ id: 'shenshen-actions', dir: 'D:/f/shenshen-actions', problem: null, extra: { count: 3 } }] });
  if (got.have?.dir !== 'D:/f/shenshen-actions') bad('restoreAction() 没有把现有包的 dir 带出来');
  else ok('修复时能拿到现有包的绝对路径');
}

/* ---------- 2. 「修复」不弹目录选择器 ---------- */
{
  const from = src.indexOf("} else if (act === 'restore-pack')");
  const to = src.indexOf("} else if (act === 'find-libs')", from + 1);
  const branch = from >= 0 && to > from ? src.slice(from, to) : '';
  if (!branch) bad('找不到 restore-pack 的点击处理分支');
  else {
    const repairPart = branch.split('} else {')[0];
    if (!/mode === 'repair'/.test(repairPart)) bad('修复分支没有按 mode 分流');
    else ok('点击处理按创建/修复分流');
    if (/pickPath/.test(repairPart)) bad('修复分支里仍然在弹目录选择器');
    else ok('修复分支不弹目录选择器');
    if (!/have\?\.\s*dir/.test(repairPart)) bad('修复分支没用现有包的 dir');
    else ok('修复分支直接用现有包的 dir');
    if (!/ctx\.invoke\('restore-pack'/.test(branch)) bad('没有调用 restore-pack');
    else ok('仍然调用 restore-pack（后端没变）');
    if (!/'正在检查并修复形象包…'/.test(branch)) bad('修复时没有进度文案');
    else ok('修复时有自己的进度文案');
  }
}

/* ---------- 3. 文案一致：不该再出现旧的「建立空的角色包」 ---------- */
{
  const hits = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => l.includes('建立空的角色包'));
  if (hits.length) bad(`还残留「建立空的角色包」文案：` + hits.map(([n, l]) => `第 ${n} 行 ${l.trim().slice(0, 60)}`).join('；'));
  else ok('没有残留「建立空的角色包」文案');
  const uses = (src.match(/restoreAction\(\)\.label/g) ?? []).length;
  if (uses < 2) bad(`note 里的按钮/指引没有跟着状态取标签（restoreAction().label 只出现 ${uses} 次）`);
  else ok(`note 里的按钮和指引共用同一个标签（${uses} 处）`);
  if (!/data-role="restore-btn"[^>]*>创建深深形象包</.test(src)) bad('按钮的初始文案不是「创建深深形象包」（首帧闪一下「修复」也算错）');
  else ok('按钮初始文案是「创建深深形象包」');
}

console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exitCode = fails.length ? 1 : 0;
