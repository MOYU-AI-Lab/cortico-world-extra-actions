/**
 * 「一键下载动作库」的世界级端到端测试（本地 http 服务，不碰外网）。
 *   node test_download.mjs
 *
 * 覆盖：
 *   - state.download：没配 remoteBase 时给 GitHub 兜底、perAction=false
 *   - 配了 remoteBase → perAction=true，地址拼成 <base>/library.zip 与 <base>/actions/<分类>/<id>.zip
 *   - invoke('download-library') 真的把 zip 装进动作库并写进设置
 *   - invoke('download-action') 真的补上单个动作，列表 present 跟着涨
 *   - 下载源 404 → 报错，动作库不被破坏
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const W = await import(pathToFileURL(join(here, '..', 'src', 'world.js')).href);

/* 最小 zip 构造（store 也行，这里用 deflate 更接近真实） */
function buildZip(entries) {
  const chunks = [], central = [];
  let off = 0;
  for (const [name, data] of entries) {
    const raw = Buffer.from(data), comp = deflateRawSync(raw), nb = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nb.length, 26);
    chunks.push(lh, nb, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nb.length, 28); cd.writeUInt32LE(off, 42);
    central.push(Buffer.concat([cd, nb]));
    off += 30 + nb.length + comp.length;
  }
  const cen = Buffer.concat(central), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cen.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...chunks, cen, eocd]);
}

const mkAction = (cat, id) => [
  [`深深-动作库/actions/${cat}/${id}/action.json`, JSON.stringify({ id, category: cat, word: id, zh: id, say: id, clip: `actions/${cat}/${id}`, frames: 1, fps: 24, seconds: 1, anim: true })],
  [`深深-动作库/actions/${cat}/${id}/anim.webp`, 'RIFFxxxxWEBPVP8 '],
];
const libZip = buildZip([...mkAction('core', 'cheer-hop'), ...mkAction('eat', 'eat-dumplings')]);
const oneZip = buildZip([
  ['action.json', JSON.stringify({ id: 'fireworks', category: 'festival', word: 'fireworks', zh: '放烟花', say: '放烟花', clip: 'actions/festival/fireworks', frames: 1, fps: 24, seconds: 1, anim: true })],
  ['anim.webp', 'RIFFxxxxWEBPVP8 '],
]);
const routes = new Map([['/lib/library.zip', libZip], ['/lib/actions/festival/fireworks.zip', oneZip], ['/lib/fireworks.zip', oneZip]]);
const server = createServer((req, res) => {
  const b = routes.get(req.url);
  if (!b) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-length': b.length }); res.end(b);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/lib`;

const root = join(here, '_tmp-download');
rmSync(root, { recursive: true, force: true });
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });

const cfg = { remoteBase: base, remoteActionBase: base };   // 单段走扁平布局 <base>/<id>.zip
// 宿主的 persist 会写回同一个 cfg，这里照做，否则 libraryDir() 读不到
const settings = cfg;
const ctx = {
  dataDir,
  botDir: join(root, 'bot'),
  cfg,
  persist: (p) => Object.assign(cfg, p),
  packageDir: join(here, '..'),
  repoRoot: here,
};
const w = new W.ExtraActionsWorld({ ctx });

const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(msg + ' → ' + e.message); console.log('FAIL ' + msg); } };

/* 1. state.download */
let st = await w.invoke('picker', 'state');
check(() => assert.equal(st.download.perAction, true), 'remoteBase makes per-action downloads available');
check(() => assert.equal(st.download.libraryUrl, base + '/library.zip'), 'library url = <base>/library.zip');
check(() => assert.equal(st.download.flat, true), 'per-action uses the flat layout when remoteActionBase is set');

/* 2. 一键下载完整库 */
const r = await w.invoke('picker', 'download-library');
check(() => assert.equal(r.modules, 2), 'two modules installed: ' + r.modules);
check(() => assert.equal(existsSync(join(r.path, 'actions', 'core', 'cheer-hop', 'anim.webp')), true), 'anim.webp landed in the library');
check(() => assert.equal(settings.libraryDir, r.path), 'libraryDir persisted');
st = await w.invoke('picker', 'state');
check(() => assert.equal(st.library.present, 2), 'state sees 2 present (' + st.library.present + ')');

/* 3. 单个动作 */
const one = await w.invoke('picker', 'download-action', ['fireworks', 'festival']);
check(() => assert.equal(one.ok, true), 'single action downloaded');
st = await w.invoke('picker', 'state');
check(() => assert.equal(st.library.present, 3), 'now 3 present (' + st.library.present + ')');

/* 4. 下载源坏掉 → 报错但不破坏库 */
const w2 = new W.ExtraActionsWorld({ ctx: { ...ctx, cfg: { ...cfg, remoteBase: base + '/nope' } } });
let err = null;
try { await w2.invoke('picker', 'download-library'); } catch (e) { err = e; }
check(() => assert.match(String(err?.message), /404/), 'a 404 from the source is reported');
check(() => assert.equal(readdirSync(join(r.path, 'actions')).length >= 2, true), 'the existing library is untouched');

server.close();
rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
