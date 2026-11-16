/**
 * 「戳一戳」的回归测试（跑真正的 figure.js，用一层假 DOM）。
 *   node test_click.mjs
 *
 * 覆盖：
 *   - 清单里有 reaction:true 的段 → 点一下播那一段
 *   - 一段 reaction 都没有（只勾了吃饭/伸懒腰这类）→ 也要动（最新兜底）
 *   - 回应时长被 REACTION_MAX（2.6s）截断，不是播满 10 秒
 *   - 被拎起（drag 模式）时不抢动作
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PLAYER = join(here, '..', 'assets', 'starter', 'figure', 'figure.js');
const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(`${msg} → ${e.message}`); console.log('FAIL ' + msg); } };

/* ---------- 假 DOM ---------- */
class El {
  constructor(tag) { this.tagName = tag; this.attrs = {}; this.children = []; this.isConnected = true; this.style = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  querySelector() { return null; }
  remove() { this.isConnected = false; }
}
globalThis.document = { createElement: (t) => new El(t), createElementNS: (_n, t) => new El(t), querySelectorAll: () => [] };
// 播放器会把每帧 fetch 成 blob 再换成 objectURL；这里把源地址塞进 blob，
// 这样 href 里仍能看出是哪一段（否则全是 blob:fake 看不出）。
URL.createObjectURL = (b) => 'blob:' + String(b?.__url ?? 'x').split('/').slice(-3).join('/');
URL.revokeObjectURL = () => {};
globalThis.fetch = async (u) => ({ ok: true, blob: async () => ({ __url: String(u) }) });
/** 播放器用 new Image() 探测 anim.webp；这里一律失败 → 走逐帧路径，href 里能直接看出是哪一段。 */
globalThis.Image = class { set src(v) { this._src = v; setTimeout(() => this.onerror?.(), 0); } get src() { return this._src; } };
let NOW = 0;
globalThis.performance = { now: () => NOW };

/* ---------- 造包 ---------- */
const root = join(here, '_tmp-click');
rmSync(root, { recursive: true, force: true });

const CLIPS = {
  idle: { id: 'state-idle', cat: 'core', word: null, seconds: 10, roles: ['idle'] },
  eat: { id: 'eat-rice', cat: 'eat', word: 'eat-rice', seconds: 10 },
  shy: { id: 'shy-startle', cat: 'core', word: 'shy-startle', seconds: 10, reaction: true },
};

const entry = (f) => ({
  id: f.id, word: f.word, clip: `actions/${f.cat}/${f.id}`, frames: 2, fps: 24, seconds: f.seconds,
  name: f.id, category: f.cat, random: false, ...(f.roles ? { roles: f.roles } : {}), ...(f.reaction ? { reaction: true } : {}),
});

function makePack(name, indexClips) {
  const pack = join(root, name);
  for (const f of Object.values(CLIPS)) {
    const d = join(pack, 'actions', f.cat, f.id);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'action.json'), JSON.stringify({
      id: f.id, category: f.cat, clip: `actions/${f.cat}/${f.id}`, word: f.word, zh: f.id, say: f.id,
      frames: 2, fps: 24, seconds: f.seconds, random: false, ...(f.roles ? { roles: f.roles } : {}), ...(f.reaction ? { reaction: true } : {}),
    }), 'utf8');
    writeFileSync(join(d, 'anim.webp'), 'RIFFxxxxWEBPVP8 ', 'utf8');
  }
  writeFileSync(join(pack, 'actions', 'index.js'), 'export default ' + JSON.stringify(Object.values(CLIPS).map(entry)) + ';\n', 'utf8');
  mkdirSync(join(pack, '额外动作拓展'), { recursive: true });
  writeFileSync(join(pack, '额外动作拓展', 'index.js'), 'export default ' + JSON.stringify(indexClips.map(entry)) + ';\n', 'utf8');
  writeFileSync(join(pack, 'figure.json'), JSON.stringify({ manifest: 2, api: 2, id: 'shenshen-actions', entry: 'figure.js' }), 'utf8');
  return pack;
}

async function load(pack) {
  const mod = await import(pathToFileURL(PLAYER).href + '?v=' + Math.random());
  const petG = new El('g');
  const kit = {
    createBody(_h, o) {
      const fig = o.figure;
      return {
        words: [], step() {}, layout: () => ({ x: 128, facing: 1, mode: 'idle' }), do: () => true,
        pointer: () => true, draw: (...a) => fig.draw(...a), react: () => fig.react(),
      };
    },
  };
  const body = await mod.createActionBody(pathToFileURL(pack + '/').href, {
    kit,
    host: { root: new El('div'), bounds: () => ({ W: 640, H: 360, floorY: 300, S: 1 }) },
    scheme: null, model: undefined,
    loadImage: async () => new El('img'),
    asset: (p) => new URL(p, pathToFileURL(pack + '/').href),
  });
  return { body, petG };
}

const href = (petG) => {
  const img = petG.children.find((c) => c.tagName === 'image');
  return img ? decodeURIComponent(String(img.attrs.href ?? '')) : '';
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * 画一帧。anim.webp 的探测是异步的（真播放器要点一下才知道能不能动），
 * 探测没回来之前播放器会「保持上一帧」，所以这里等一下让探针落地。
 */
const drawAt = async (body, petG, t, mode = 'idle') => {
  // 画三次、中间各让一次事件循环：切换片段 → 探测 anim.webp（异步）→ 下一帧才真正换图
  for (let i = 0; i < 3; i++) {
    NOW = t * 1000;
    body.draw(petG, {}, { t, mode, facing: 1 });
    await sleep(10);
  }
};
const click = (body, at) => { NOW = at; body.pointer('down', { x: 100, y: 100 }); NOW = at + 60; body.pointer('up', { x: 100, y: 100 }); };

/* ① 有"点击段"：播它，2.6s 后回待机 */
{
  const pack = makePack('with-reaction', [CLIPS.shy, CLIPS.eat]);
  const { body, petG } = await load(pack);
  await drawAt(body, petG, 0); drawAt(body, petG, 0.1);
  click(body, 100);
  await drawAt(body, petG, 0.2);
  check(() => { const h = href(petG); if (!/shy-startle/.test(h)) throw new Error('点完播的是：' + h); }, '有 reaction 段时：点一下播那一段');
  await drawAt(body, petG, 2.4);
  check(() => { const h = href(petG); if (!/shy-startle/.test(h)) throw new Error('2.4 秒就回待机了：' + h); }, '2.4 秒时仍在播（没被过早截断）');
  await drawAt(body, petG, 3.2);
  check(() => { const h = href(petG); if (!/state-idle/.test(h)) throw new Error('3.2 秒还在播：' + h); }, '过了 2.6 秒回待机');
}

/* ② 没有"点击段"：也要动 */
{
  const pack = makePack('no-reaction', [CLIPS.eat]);
  const { body, petG } = await load(pack);
  await drawAt(body, petG, 0); drawAt(body, petG, 0.1);
  click(body, 100);
  await drawAt(body, petG, 0.2);
  check(() => { const h = href(petG); if (!/eat-rice/.test(h)) throw new Error('完全没有反应：' + h); }, '没有"点击段"时也会挑一段响应（兜底）');
  await drawAt(body, petG, 3.1);
  check(() => { const h = href(petG); if (!/state-idle/.test(h)) throw new Error('没回待机：' + h); }, '兜底回应同样按时回待机');
}

/* ③ 被拎起时不抢动作 */
{
  const pack = makePack('drag', [CLIPS.shy]);
  const { body, petG } = await load(pack);
  await drawAt(body, petG, 0, 'drag');
  check(() => { if (body.react() !== false) throw new Error('drag 时还抢了动作'); }, '被拎起时不响应点击');
}

/* ④ 空包不抛错 */
{
  const pack = makePack('empty', []);
  const { body, petG } = await load(pack);
  await drawAt(body, petG, 0);
  check(() => { body.react(); }, '什么都没有时点一下不抛错');
}

/* ⑤ 播放器文件本身带标记 */
check(() => {
  const s = readFileSync(PLAYER, 'utf8');
  if (!s.includes('REACTION_MAX')) throw new Error('没有 REACTION_MAX');
  if (!s.includes('pool = [...allow].filter((w) => byWord.has(w));')) throw new Error('没有"随便挑一段"的兜底');
}, '播放器里有 REACTION_MAX 与点击兜底');

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
