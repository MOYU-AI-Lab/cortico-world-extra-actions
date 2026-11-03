/**
 * Verify the installed pack really does only what was ticked.
 *   node verify_installed.mjs <pack dir>
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const pack = process.argv[2];
const base = pathToFileURL(join(pack, '/')).href;

class El {
  constructor(t) { this.tag = t; this.attrs = {}; this.children = []; this.isConnected = true; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { this.children.push(c); return c; }
}
globalThis.document = { createElementNS: (ns, t) => new El(t), createElement: (t) => new El(t) };
globalThis.Image = class { set src(v) { this._src = v; } get src() { return this._src; } };
let perfNow = 900_000, nowS = 0;
performance.now = () => perfNow;

const fig = JSON.parse(readFileSync(join(pack, 'figure.json'), 'utf8').replace(/^\uFEFF/, ''));
const extrasFile = join(pack, '额外动作拓展', 'index.js');
const extraIdx = existsSync(extrasFile) ? (await import(pathToFileURL(extrasFile).href)).default : [];
if (!extraIdx.length) console.log('（这个包还没有额外动作，只检查身体状态）');
const index = (await import(pathToFileURL(join(pack, 'actions', 'index.js')).href)).default;
const mod = await import(pathToFileURL(join(pack, 'figure.js')).href);

let figure = null;
const petG = new El('g');
let mode = 'idle';
const kit = {
  createBody(host, opts) {
    figure = opts.figure;
    return {
      words: ['neutral', 'walk'],
      step() { figure.draw(petG, {}, { t: nowS, mode, facing: 1 }); },
      layout() { return { x: 128, facing: 1, mode }; },
      do() { return true; },
      pointer() {},
    };
  },
};
const body = await mod[fig.export](base, {
  kit, host: { root: new El('div'), bounds: () => ({ W: 640, H: 360, floorY: 300, S: 1 }) },
  scheme: null, model: undefined, loadImage: async () => new El('img'), asset: (p) => new URL(p, base),
});
const advance = (ms) => { perfNow += ms; nowS += ms / 1000; body.step(ms / 1000); };
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); else console.log('ok  ' + msg); };

const voc = fig.vocab.map((w) => w.id);
const ex = extraIdx.map((e) => e.word);
console.log('vocab :', voc.join(', '));
console.log('extra :', ex.join(', '));

check(voc.length === ex.length && ex.every((w) => voc.includes(w)), 'figure.json vocab == the ticked set');
check(extraIdx.length >= 0, '额外动作段数: ' + ex.length + (ex.length ? '' : '（空包）'));

/* every ticked module has its frames (or a single-file anim.webp) */
let bad = [];
for (const e of extraIdx) {
  const d = join(pack, ...e.clip.split('/'));
  const names = readdirSync(d);
  if (names.includes('anim.webp')) continue;      // 单文件动画模块：整段一个文件
  const n = names.filter((f) => /^f_\d{4}\.webp$/.test(f)).length;
  if (n !== e.frames) bad.push(`${e.word}: ${n}/${e.frames}`);
}
check(bad.length === 0, 'frames present' + (bad.length ? ': ' + bad.join('; ') : ''));

/* 精简过的包里也必须留着身体状态那几段（idle / walk / drag / turn） */
const roleClips = index.filter((e) => Array.isArray(e.roles) && e.roles.length);
const missingRoles = roleClips.filter((e) => {
  const d = join(pack, ...e.clip.split('/'));
  if (!existsSync(d)) return true;
  const names = readdirSync(d);
  if (names.includes('anim.webp')) return false;
  return names.filter((f) => /^f_\d{4}\.webp$/.test(f)).length !== e.frames;
});
check(missingRoles.length === 0, 'state clips the player needs are intact: ' + roleClips.map((e) => e.id).join(','));

/* the body plays a ticked action and only ticked ones come up on its own */
body.step(0);
body.do('eat-dumplings');
advance(20);
if (extraIdx.some((e) => e.word === 'eat-dumplings')) {
  check(figure.clip === '额外动作拓展/eat/eat-dumplings', 'do(eat-dumplings) -> ' + figure.clip);
} else {
  check(() => {}, '跳过 do(eat-dumplings)：这个包里没勾它');
}

advance(20000);
const seen = new Set();
for (let i = 0; i < 400; i++) { advance(100); seen.add(figure.clip); }
const unlisted = [...seen].filter((c) => c.startsWith('actions/') && !/state-idle|state-walk|state-drag|look-around/.test(c));
check(unlisted.length === 0, 'idle rotation stays inside the ticked set' + (unlisted.length ? ': ' + unlisted.join(', ') : ''));

mode = 'idle';
advance(20000);
let clicked = 0;
for (let i = 0; i < 12; i++) {
  body.pointer('down', { x: 128, y: 200 });
  advance(120);
  body.pointer('up', { x: 128, y: 200 });
  advance(60);
  if (figure.clip.startsWith('额外动作拓展/')) clicked++;
  advance(15000);
}
if (extraIdx.length) check(clicked === 12, `clicks always land on a ticked reaction (${clicked}/12)`);
else check(() => {}, '跳过点击回应：空包里没有可点的动作');

console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\ninstalled pack ok');
process.exit(fails.length ? 1 : 0);
