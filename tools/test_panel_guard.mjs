import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/**
 * 面板模板自检的回归测试：模板少一个节点时必须当场抛错，而不是留成静默 null。
 *   node test_panel_guard.mjs
 */
const PATH = new URL('../dist/webui.js', import.meta.url).href;

class N {
  constructor(tag) {
    this.tag = tag; this.children = []; this.style = {}; this.dataset = {}; this._html = '';
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    this.disabled = false;
  }
  set innerHTML(v) { this._html = String(v); } get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); } get textContent() { return this._text ?? ''; }
  appendChild(c) { this.children.push(c); return c; }
  insertBefore(c) { this.children.unshift(c); return c; }
  insertAdjacentHTML() {}
  addEventListener() {}
  setAttribute() {} getAttribute() { return null; }
  remove() {} closest() { return null; }
  get firstChild() { return this.children[0]; }
  querySelector() { return new N('x'); }
  querySelectorAll() { return []; }
}

const fails = [];
const ok = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(msg + ' → ' + e.message); console.log('FAIL ' + msg); } };

/* 第一轮：正常模板，必须挂载成功 */
globalThis.document = {
  body: { appendChild: () => {}, querySelectorAll: () => [] },
  createElement: (t) => new N(t), createElementNS: (ns, t) => new N(t), querySelectorAll: () => [],
};
const m = await import(PATH);
await m.default.panels.picker.mount({
  root: new N('div'),
  invoke: async (method) => {
    if (method === 'catalog') return { actions: [], count: 0, words: 0, categories: [] };
    return { figures: [], current: null, pick: null, library: { ok: false, count: 0 }, figuresDir: 'F' };
  },
  pickPath: async () => null,
  ui: {},
});
ok(() => {}, 'mount succeeds with the real template');

/* 第二轮：让模板少一个节点（丢掉「压缩包」按钮），必须报错并指出缺哪个 */
const orig = N.prototype.querySelector;
N.prototype.querySelector = function (sel) {
  if (sel === '[data-act=prune]') return null;
  return orig.call(this, sel);
};
let err = null;
try {
  await m.default.panels.picker.mount({
    root: new N('div'),
    invoke: async () => ({ actions: [], count: 0, words: 0, categories: [] }),
    pickPath: async () => null,
    ui: {},
  });
} catch (e) { err = e; }
N.prototype.querySelector = orig;
ok(() => {
  if (!err) throw new Error('没有抛错 —— 又会变成静默 null');
  if (!String(err.message).includes('data-act=prune')) throw new Error('报错没指出缺哪个节点：' + err.message);
}, 'a missing template node fails loudly: ' + (err ? err.message : '(no error)'));

/* 第三轮：静态校验 —— 自检清单里的每个选择器都必须真的出现在模板里。
   这一条能提前抓住"按钮只写在动态 innerHTML 里、模板里没有"这类事故。
   注意用 fileURLToPath：PATH 是 file:// URL，路径里有中文（形象包 / 中文用户名）时
   直接 replace("file:///") 拿到的是 %E5%BD%A2… 这种百分号编码，读不到文件。 */
{
  const src = readFileSync(fileURLToPath(PATH), "utf8");
  const start = src.indexOf("wrap.innerHTML = `");
  const tpl = src.slice(start + "wrap.innerHTML = `".length, src.indexOf("`;", start));
  const reqBlock = src.slice(src.indexOf("const REQUIRED = ["), src.indexOf("];", src.indexOf("const REQUIRED = [")));
  const required = [...reqBlock.matchAll(/'\[([^\]]+)\]'/g)].map((m) => m[1]);
  const absent = required.filter((sel) => {
    const m = /^data-(role|act)=(.+)$/.exec(sel);
    if (!m) return !tpl.includes(sel.replace(/^\./, 'class="').replace(/$/, '"'));
    return !tpl.includes(`data-${m[1]}="${m[2]}"`);
  });
  ok(() => { if (!required.length) throw new Error("没解析到自检清单"); }, `parsed ${required.length} required selectors`);
  ok(() => { if (absent.length) throw new Error("模板里没有：" + absent.join(", ")); }, 'every required selector exists in the static template');
}
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
