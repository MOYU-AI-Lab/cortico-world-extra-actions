/**
 * petReload() 的自测：用一个假桌宠服务证明它「只回填当前形象、不改任何设置」。
 *
 *   node tools/test_reload.mjs
 *
 * 为什么单独测这个：0.3.34 之前插件只读 /api/state 与 /api/figures，保存完丢给用户
 * 一句「去装扮页点一下」。现在保存后会自动重载一次 —— 这条路径必须证明
 *   (1) 发的就是 /api/state 里的现值，一个字都不改；
 *   (2) 桌宠没开 / 没形象时不炸，只是抛错让调用方退回老提示。
 */
import http from 'node:http';
import assert from 'node:assert/strict';

let calls = [];
let stateBody = { skin: { figure: 'shenshen-actions', scheme: '', palette: 'mint', shenshen: '' } };
let skinStatus = 200;

const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/api/state' && req.method === 'GET') return send(200, stateBody);
  if (req.url === '/api/figures' && req.method === 'GET') return send(200, []);
  if (req.url === '/api/skin' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(raw || '{}'); } catch { /* 留 null */ }
      calls.push({ url: req.url, method: req.method, body, raw });
      send(skinStatus, skinStatus === 200 ? { ok: true } : { error: 'nope' });
    });
    return;
  }
  send(404, { error: 'not found' });
});

await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
process.env.COOPANION_PET_PORTS = String(port);
delete process.env.COOPANION_PET_OFF;

const { petReload } = await import('../src/pet.js');

const ok = (msg) => console.log('ok  ' + msg);

/* 1. 正常路径：整份 skin 原样回填，且必须是 { skin: … } 这个形状 */
{
  calls = [];
  const r = await petReload();
  assert.equal(r.ok, true);
  assert.equal(r.figure, 'shenshen-actions');
  assert.equal(calls.length, 1, '应该只发一次 POST /api/skin');
  const b = calls[0].body;
  assert.deepEqual(Object.keys(b), ['skin'], '接口要的是 { skin: {…} }，不是扁平字段');
  assert.deepEqual(b.skin, stateBody.skin, '回填的必须是 /api/state 里那份 skin，一字不改');
  ok('回填形状是 { skin: {…} }，且与 /api/state 的 skin 完全相同');
}

/* 2. 桌宠没有形象：抛错，不去发 POST */
{
  calls = [];
  stateBody = { skin: {} };
  await assert.rejects(() => petReload(), /没有形象/);
  assert.equal(calls.length, 0, '没形象的时候不该发 POST');
  ok('桌宠没有形象时直接报错，不乱发请求');
}

/* 3. 服务端拒绝：抛错带上状态码 */
{
  calls = [];
  stateBody = { skin: { figure: 'shenshen-actions', scheme: '', palette: 'mint', shenshen: '' } };
  skinStatus = 500;
  await assert.rejects(() => petReload(), /HTTP 500/);
  skinStatus = 200;
  ok('服务端拒绝时把状态码带出来');
}

/* 4. 桌宠没开：抛错（调用方据此退回「去装扮页点一下」） */
{
  server.close();
  await new Promise((ok2) => setTimeout(ok2, 50));
  delete process.env.COOPANION_PET_PORTS;
  await assert.rejects(() => petReload(), /没找到|timeout/i);
  ok('桌宠没开时抛错，不会假装成功');
}

console.log('\n全部通过');
