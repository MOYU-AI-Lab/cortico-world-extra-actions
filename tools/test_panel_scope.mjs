/**
 * 面板作用域检查：抓「只在点击回调里声明、却被外层函数使用」的变量。
 *
 * 真实事故：`const busy = ...` 写在 `wrap.addEventListener('click', ...)` 里，
 * 而 `doDownloadLibrary()` / `downloadOne()` 定义在外层，运行时抛
 * `busy is not defined` —— 用户点「一键下载并安装」就弹这个错。
 *
 * 判定：
 *   1. 收集事件回调内 const/let/var 声明出的名字；
 *   2. 名字若在回调之外也有声明（函数参数 / 函数内 const / 顶层声明）→ 正常遮蔽，跳过；
 *   3. 否则只要外层函数体用到它 → 报错。
 *
 *   node tools/test_panel_scope.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'dist', 'webui.js'), 'utf8');

const fails = [];
const ok = (m) => console.log('ok   ' + m);

function matchBrace(text, openIdx) {
  let depth = 0;
  let i = openIdx;
  let mode = null;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; }
    else if (mode === 'block') { if (c === '*' && next === '/') { mode = null; i++; } }
    else if (mode === 'str') { if (c === '\\') i++; else if (c === "'" || c === '"') mode = null; }
    else if (mode === 'tpl') { if (c === '\\') i++; else if (c === '`') mode = null; }
    else {
      if (c === '/' && next === '/') { mode = 'line'; i++; }
      else if (c === '/' && next === '*') { mode = 'block'; i++; }
      else if (c === "'" || c === '"') mode = 'str';
      else if (c === '`') mode = 'tpl';
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return i; }
    }
    i++;
  }
  return -1;
}

function stripLiterals(text) {
  let out = '';
  let i = 0;
  let mode = null;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (mode === 'line') { out += c === '\n' ? '\n' : ' '; if (c === '\n') mode = null; }
    else if (mode === 'block') { out += c === '\n' ? '\n' : ' '; if (c === '*' && next === '/') { mode = null; out += ' '; i++; } }
    else if (mode === 'str' || mode === 'tpl') {
      out += c === '\n' ? '\n' : ' ';
      if (c === '\\') { out += ' '; i++; }
      else if ((mode === 'str' && (c === "'" || c === '"')) || (mode === 'tpl' && c === '`')) mode = null;
    } else {
      if (c === '/' && next === '/') { mode = 'line'; out += '  '; i++; }
      else if (c === '/' && next === '*') { mode = 'block'; out += '  '; i++; }
      else if (c === "'" || c === '"') { mode = 'str'; out += ' '; }
      else if (c === '`') { mode = 'tpl'; out += ' '; }
      else out += c;
    }
    i++;
  }
  return out;
}

/* 事件回调 */
const handlers = [];
const reH = /addEventListener\(\s*['"]([a-z]+)['"]/g;
let m;
while ((m = reH.exec(src))) {
  const braceIdx = src.indexOf('{', m.index + m[0].length);
  if (braceIdx < 0) continue;
  const end = matchBrace(src, braceIdx);
  if (end < 0) continue;
  handlers.push({ event: m[1], start: braceIdx, end });
}
ok(`找到 ${handlers.length} 个事件回调`);

/* 函数：记录 参数 + 自身局部声明 */
const funcs = [];
const reF = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
while ((m = reF.exec(src))) {
  const braceIdx = src.indexOf('{', m.index);
  const end = matchBrace(src, braceIdx);
  if (end < 0) continue;
  const body = stripLiterals(src.slice(braceIdx, end + 1));
  const own = new Set(
    m[2].split(',').map((x) => x.trim().replace(/=.*$/, '').trim()).filter(Boolean)
      .concat([...body.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((x) => x[1])),
  );
  funcs.push({ name: m[1], start: braceIdx, end, body, own });
}
// 把回调整段抹掉后再算"外层声明"，否则回调里的声明会被误当成外层已有
let outside = stripLiterals(src);
for (const h of handlers) {
  outside = outside.slice(0, h.start) + ' '.repeat(h.end - h.start + 1) + outside.slice(h.end + 1);
}
const topDecls = new Set([...outside.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)].map((x) => x[1]));
ok(`找到 ${funcs.length} 个函数、${topDecls.size} 个声明名`);

for (const h of handlers) {
  const body = stripLiterals(src.slice(h.start, h.end + 1));
  const declared = new Set([...body.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((x) => x[1]));

  for (const name of declared) {
    for (const fn of funcs) {
      if (fn.start > h.start && fn.end < h.end) continue;
      if (!new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).test(fn.body)) continue;
      if (fn.own.has(name) || topDecls.has(name)) continue;
      fails.push(`「${h.event}」回调里声明的 \`${name}\` 被外层 ${fn.name}() 使用，但外层没有声明 → 运行时会 ReferenceError`);
    }
  }
}

if (!fails.length) ok('没有「只在回调里声明、外层却使用」的变量');
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
