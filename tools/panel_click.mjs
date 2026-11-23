/**
 * 面板点击冒烟测试：在无头 Chrome 里真实点一遍面板上的每个按钮，
 * 抓 ReferenceError / TypeError 这类运行时错误。
 *
 * 为什么需要：`busy is not defined` 这种 bug，静态分析不好判，
 * 但只要真的点一下「一键下载并安装」就会炸 —— 这个测试就是点给它看。
 *
 *   node tools/panel_click.mjs
 *
 * 需要：本机有 chrome-headless-shell（路径可用环境变量 CHROME_BIN 覆盖）。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');

const CHROME = process.env.CHROME_BIN
  || 'D:\\dsh-skills\\browsers\\chrome-headless-shell-win64\\chrome-headless-shell.exe';

if (!existsSync(CHROME)) {
  console.log('SKIP 找不到 chrome-headless-shell（设 CHROME_BIN 指向它）');
  process.exit(0);
}

/* 快照：没有真机快照就用最小可用的假数据 */
const snapPath = join(root, 'tools', 'panel_snapshot.min.json');
const snapshot = existsSync(snapPath)
  ? readFileSync(snapPath, 'utf8')
  : JSON.stringify({
      state: {
        api: 6,
        figures: [],
        pick: null,
        current: null,
        library: { ok: false, dir: '', count: 105, present: 0, missing: 105, words: 0, imported: 0, categories: [] },
        installed: { ok: true, ids: [], problems: [], missing: [], present: 0, bytes: 0 },
        onboard: { seen: true, downloadUrl: '' },
        version: '0.0.0-test',
      },
      catalog: { count: 105, actions: [] },
    }, null, 2);

const TMP = mkdtempSync(join(tmpdir(), 'panel-click-'));

const harness = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>booting</title>
<style>
  #host{width:960px;padding:24px 26px 30px;background:#fbfbfb;box-sizing:border-box;margin:22px auto;
        font-family:"Microsoft YaHei",system-ui,sans-serif;min-height:600px}
  #out{white-space:pre-wrap;font:12px/1.5 Consolas,monospace;padding:10px 12px;margin:8px 0}
</style></head>
<body>
<div id="host"></div>
<pre id="out"></pre>
<script type="module">
const out = document.getElementById('out');
const errors = [];
const push = (s) => { errors.push(s); document.title = 'FAIL|' + errors.map((e) => encodeURIComponent(String(e).slice(0, 160))).join('||'); };
window.addEventListener('error', (e) => push('window: ' + (e.error?.stack || e.message)));
window.addEventListener('unhandledrejection', (e) => push('promise: ' + (e.reason?.stack || e.reason)));

let snap = {};
try { snap = await (await fetch('panel_snapshot.json')).json(); } catch (e) { push('snapshot: ' + e); }

const table = {
  state: () => snap.state,
  catalog: () => snap.catalog,
  figures: () => snap.figures ?? [],
  packs: () => snap.figures ?? [],
  installed: () => snap.installed,
  'download-progress': () => ({ active: false }),
};
const ctx = {
  root: document.getElementById('host'),
  async invoke(method, args) {
    const k = String(method);
    if (table[k]) return table[k](args);
    if (k === 'set-library') throw new Error('这套测试里不真的选库');
    return null;
  },
  async pickPath() { return null; },
  async persist() {},
};

try {
  const mod = await import('./webui.js');
  await mod.default.panels.picker.mount(ctx);
} catch (e) {
  push('mount: ' + (e?.stack || e));
}

/* 逐个点按钮：每个都等一下，让异步分支跑完 */
const buttons = [...document.querySelectorAll('#host [data-act]')];
for (const b of buttons) {
  try {
    b.click();
  } catch (e) {
    push('click(' + b.dataset.act + '): ' + (e?.stack || e));
  }
  await new Promise((r) => setTimeout(r, 30));
}
if (!errors.length) document.title = 'PASS|' + buttons.length + '|' + document.querySelectorAll('#host *').length + '|' + encodeURIComponent((document.getElementById('host').innerHTML || '').slice(0, 300));
</script>
</body></html>`;

writeFileSync(join(TMP, 'click.html'), harness, 'utf8');
writeFileSync(join(TMP, 'panel_snapshot.json'), snapshot, 'utf8');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const name = url === '/' ? 'click.html' : url.slice(1);
  const file = name === 'webui.js' ? join(dist, 'webui.js') : join(TMP, name);
  if (!existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const html = await new Promise((resolve) => {
  const ch = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--virtual-time-budget=20000', '--dump-dom', `http://127.0.0.1:${port}/click.html`,
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '';
  ch.stdout.on('data', (d) => { buf += d.toString(); });
  ch.on('exit', () => resolve(buf));
  ch.on('error', () => resolve(''));
});

server.close();
rmSync(TMP, { recursive: true, force: true });

const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
const fails = title.startsWith('FAIL|')
  ? title.slice(5).split('||').map((x) => decodeURIComponent(x))
  : [];

if (!html) {
  console.log('FAIL 浏览器没有输出 DOM（chrome 没跑起来？）');
  process.exit(1);
}
if (fails.length) {
  console.log('FAIL 点击时出现运行时错误：');
  for (const f of fails.slice(0, 12)) console.log('  - ' + f);
  process.exit(1);
}
console.log(`ok   点击 ${title.replace('PASS|', '')} 个按钮，没有运行时错误`);
console.log('\nall checks passed');
