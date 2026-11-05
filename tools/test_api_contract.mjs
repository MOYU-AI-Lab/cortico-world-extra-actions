/**
 * 面板 ↔ 后台 的接口契约测试。
 *
 * 为什么需要：面板（webui.js）是每次打开都从磁盘读的，而后台的 world 模块只在
 * Coopanion 启动时 import 一次。扩展更新后没重启，就会出现「面板调了新方法、
 * 后台还没有」→ 用户看到一句"接口异常"（日志里是 unknown method），很难自己想到要重启。
 *
 * 这里静态比对：面板 invoke 的方法名，必须都在 world 的 METHODS 清单里；
 * 并且 world 的 switch 必须真的实现了 METHODS 里的每一个。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(here, '..', 'dist', 'webui.js'), 'utf8');
const world = readFileSync(join(here, '..', 'src', 'world.js'), 'utf8');

const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(`${msg} → ${e.message}`); console.log('FAIL ' + msg); } };

const panelMethods = [...new Set([...panel.matchAll(/invoke\('([a-z-]+)'/g)].map((m) => m[1]))].sort();
const methodsBlock = world.match(/const METHODS = \[([\s\S]*?)\];/);
const declared = methodsBlock ? [...new Set([...methodsBlock[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]))].sort() : [];
const cases = [...new Set([...world.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]))].sort();

console.log(`面板调用 ${panelMethods.length} 个方法：${panelMethods.join(', ')}`);
console.log(`world 声明 ${declared.length} 个，实现 ${cases.length} 个`);

check(() => {
  if (!methodsBlock) throw new Error('world 里找不到 METHODS 清单');
}, 'world 有 METHODS 清单');

check(() => {
  const missing = panelMethods.filter((m) => !declared.includes(m));
  if (missing.length) throw new Error('面板调了但 METHODS 没声明：' + missing.join(', '));
}, '面板调用的方法都在 METHODS 里');

check(() => {
  const unimplemented = declared.filter((m) => !cases.includes(m));
  if (unimplemented.length) throw new Error('METHODS 声明了但 switch 没实现：' + unimplemented.join(', '));
}, 'METHODS 里的每个方法都真的实现了');

check(() => {
  if (!world.includes('api: METHODS')) throw new Error('state 里没带出 api 字段');
}, 'state 会带出 api 清单（面板据此判断版本是否一致');

check(() => {
  const guarded = /apiHas\('download-library'\)/.test(panel) || panel.includes("includes('download-library')");
  if (!guarded) throw new Error('面板没有检查 api 里有没有 download-library');
}, '面板会先检查后台支不支持下载再显示按钮');

check(() => {
  if (!panel.includes('unknown method')) throw new Error('面板没有针对 unknown method 的友好提示');
}, '面板把 unknown method 翻译成「重启 Coopanion」的提示');

check(() => {
  if (!cases.includes('reload')) throw new Error('world 没有 reload 别名');
}, 'world 保留了 reload 别名（兼容老面板）');

console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
