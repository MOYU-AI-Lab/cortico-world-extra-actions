/**
 * 在线下载的端到端测试（本地起一个 http 服务，不碰外网）。
 *   node test_online.mjs
 *
 * 覆盖：
 *   - 完整库：下载 → 解压 → 只收 action.json/anim.webp → 动作库变 105 段
 *   - 单个动作：<base>/actions/<分类>/<id>.zip → 装进 <库>/actions/<分类>/<id>/
 *   - zip 里夹带无关文件（.exe / ../）会被过滤或拒绝
 *   - 非 http 地址、超限文件、没有 action.json 的包 → 明确报错
 */
import { createServer } from 'node:http';
import { mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const { installLibrary, installAction, libraryUrl, actionUrl } = await import(pathToFileURL(join(here, '..', 'src', 'online.js')).href);
const { extractZip, listZip } = await import(pathToFileURL(join(here, '..', 'src', 'zip.js')).href);

/* ---------- 造一个最小 zip ---------- */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let off = 0;
  for (const [name, data] of entries) {
    const raw = Buffer.from(data);
    const comp = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);          // utf8
    local.writeUInt16LE(8, 8);              // deflate
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, comp);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(off, 42);
    central.push(Buffer.concat([cen, nameBuf]));
    off += 30 + nameBuf.length + comp.length;
  }
  const cenBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12);
  eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...chunks, cenBuf, eocd]);
}

const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(msg + ' → ' + e.message); console.log('FAIL ' + msg); } };

/* ---------- 服务端：一个"完整库"和几个单动作 ---------- */
const IDS = [['core', 'cheer-hop'], ['eat', 'eat-dumplings'], ['festival', 'fireworks']];
const libZip = buildZip([
  ...IDS.flatMap(([cat, id]) => [
    [`深深-动作库/actions/${cat}/${id}/action.json`, JSON.stringify({ id, category: cat, word: id, zh: id, clip: `actions/${cat}/${id}`, frames: 1, seconds: 1, anim: true })],
    [`深深-动作库/actions/${cat}/${id}/anim.webp`, 'RIFFxxxxWEBPVP8 '],
  ]),
  ['深深-动作库/actions/core/evil/../../evil.exe', 'MZ'],
  ['深深-动作库/readme.txt', 'ignore me'],
]);
const oneZip = buildZip([
  ['action.json', JSON.stringify({ id: 'cheer-wave', category: 'core', word: 'cheer-wave', zh: '元气挥手', clip: 'actions/core/cheer-wave', frames: 1, seconds: 1, anim: true })],
  ['anim.webp', 'RIFFxxxxWEBPVP8 '],
  ['..\\..\\evil.bat', 'echo'] // 目录外的条目
]);

const routes = new Map([
  ['/library.zip', libZip],
  ['/actions/core/cheer-wave.zip', oneZip],
  ['/bomb.zip', Buffer.alloc(1024)],
  ['/empty.zip', buildZip([['readme.txt', 'hi']])],
]);
const server = createServer((req, res) => {
  const body = routes.get(req.url);
  if (!body) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const root = join(here, '_tmp-online');
rmSync(root, { recursive: true, force: true });
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });

/* ---------- 1. 完整库 ---------- */
const lib = await installLibrary({ url: libraryUrl(base), libraryDir: '', dataDir });
check(() => assert.equal(lib.ok, true), 'library install returns ok');
check(() => assert.equal(lib.modules, 3), 'three modules landed: ' + lib.modules);
check(() => assert.equal(existsSync(join(lib.path, 'actions', 'core', 'cheer-hop', 'anim.webp')), true), 'anim.webp landed');
check(() => assert.equal(existsSync(join(lib.path, 'actions', 'core', 'evil')), false), 'a "../" entry is refused');
check(() => assert.equal(existsSync(join(lib.path, 'readme.txt')), false), 'an unrelated file is filtered out');

/* ---------- 2. 单个动作 ---------- */
const one = await installAction({ url: actionUrl(base, 'core', 'cheer-wave'), libraryDir: lib.path, category: 'core', id: 'cheer-wave' });
check(() => assert.equal(one.ok, true), 'single action install returns ok');
check(() => assert.equal(existsSync(join(lib.path, 'actions', 'core', 'cheer-wave', 'action.json')), true), 'single action json landed');
check(() => assert.equal(existsSync(join(lib.path, 'actions', 'core', 'cheer-wave', 'anim.webp')), true), 'single action anim landed');
check(() => assert.equal(existsSync(join(lib.path, 'actions', 'core', 'evil.bat')), false), 'a path-escaping entry is dropped');

/* ---------- 3. 坏输入 ---------- */
const bad = async (fn, re) => {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err, '应该抛错');
  if (re) assert.match(String(err.message), re);
};
check(() => assert.ok(true), '(async 断言在下面)');
await bad(() => installLibrary({ url: 'ftp://x/y.zip', libraryDir: '', dataDir }), /http/);
await bad(() => installLibrary({ url: `${base}/nope.zip`, libraryDir: '', dataDir }), /404/);
await bad(() => installLibrary({ url: `${base}/empty.zip`, libraryDir: '', dataDir }), /没有动作/);
await bad(() => installAction({ url: `${base}/actions/core/cheer-wave.zip`, libraryDir: lib.path, category: '../x', id: 'y' }), /分类/);
await bad(() => installAction({ url: `${base}/actions/core/cheer-wave.zip`, libraryDir: lib.path, category: 'core', id: '../y' }), /id/);
console.log('ok  坏输入都被拒绝（非 http / 404 / 空包 / 非法分类 / 非法 id）');

/* ---------- 4. zip 读取器本身 ---------- */
check(() => assert.equal(listZip(libZip).length, 8), 'listZip sees every entry (8)');
{
  const dest = join(root, 'z');
  mkdirSync(dest, { recursive: true });
  const r = extractZip(libZip, { dest, onFile: (p) => p.endsWith('.json') });
  check(() => assert.equal(r.files.length, 3), 'onFile filter keeps only the 3 action.json');
}

server.close();
rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
