#!/usr/bin/env node
/**
 * 体检：额外动作拓展到底注册上没有。
 *   node tools/check-registered.mjs
 *
 * 看四件事（都是只读）：
 *   1. 包能不能按宿主的解析方式找到（data/extensions/package.json → node_modules → main）
 *   2. 默认导出是否满足 isWorldDefinition（id/label/defaults/create）
 *   3. config.json 里有没有 worlds.extra-actions 段、开没开
 *   4. core.log 最近一次启动是什么时候、有没有 World 已启动: extra-actions / 导入失败
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const NAME = 'cortico-world-extra-actions';
const WORLD = 'extra-actions';
const APP = process.env.COOPANION_DIR || '';
if (!APP) {
  console.error('需要 COOPANION_DIR=<Coopanion 安装目录>（含 Coopanion.exe 的那一层）。这里不猜路径。');
  process.exit(2);
}
const extDir = join(APP, 'data', 'extensions');
const home = join(APP, 'data', 'home', 'companion');
const log = join(APP, 'data', 'logs', 'core.log');

const ok = (m) => console.log('ok   ' + m);
const bad = (m) => console.log('BAD  ' + m);
const info = (m) => console.log('     ' + m);

let verdict = 'unknown';

/* 1. 解析 */
try {
  const req = createRequire(join(extDir, 'package.json'));
  const pkgPath = req.resolve(`${NAME}/package.json`);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const entry = resolve(dirname(pkgPath), pkg.main ?? 'index.js');
  ok(`包能找到：${pkgPath}`);
  info(`kind=${pkg.cortico?.kind} api=${pkg.cortico?.api} client=${pkg.cortico?.webUiClient}`);
  if (!existsSync(entry)) bad(`入口不存在：${entry}`);
  else ok(`入口存在：${entry}`);

  const mod = await import(new URL(`file:///${entry.replace(/\\/g, '/')}`).href);
  const d = mod.default;
  const shape = !!d && typeof d.id === 'string' && typeof d.label === 'string'
    && typeof d.defaults === 'function' && typeof d.create === 'function';
  shape ? ok(`默认导出满足 isWorldDefinition（id=${d.id}）`) : bad('默认导出不满足 isWorldDefinition');
  if (d?.id !== WORLD) bad(`导出 id 是 ${d?.id}，不是 ${WORLD}`);
} catch (e) {
  bad(`解析失败：${e.message}`);
  verdict = 'install';
}

/* 2. config.json */
try {
  const cfg = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
  const sec = cfg.worlds?.[WORLD];
  if (!sec) info(`config.json 里还没有 worlds.${WORLD}（宿主第一次启动时才会建）`);
  else if (sec.enabled) ok(`worlds.${WORLD}.enabled = true`);
  else info(`worlds.${WORLD} 已建但 enabled=false —— 在侧栏里打开它`);
} catch (e) {
  bad(`读 config.json 失败：${e.message}`);
}

/* 3. 日志 */
try {
  const text = readFileSync(log, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const boots = lines.filter((l) => /World 已启动:/.test(l));
  const last = boots[boots.length - 1];
  info(`日志里最后一次 World 已启动：${last ?? '(没有)'}`);
  const mine = lines.filter((l) => l.includes(WORLD) || l.includes('额外动作拓展'));
  if (mine.length) {
    ok(`日志里出现了 ${mine.length} 行相关记录：`);
    for (const l of mine.slice(-5)) info('  ' + l);
  } else {
    info('日志里没有任何 extra-actions / 额外动作拓展 的记录 —— 说明这次启动没扫到它');
  }
  const fails = lines.filter((l) => /扩展导入失败|constructFailed|扩展.*失败/.test(l)).slice(-5);
  if (fails.length) {
    bad('有扩展相关的失败记录：');
    for (const l of fails) info('  ' + l);
  }
} catch (e) {
  info(`读日志失败：${e.message}`);
}

/* 4. 结论 */
try {
  const text = readFileSync(log, 'utf8');
  const mine = text.includes(`World 已启动: ${WORLD}`) || text.includes('额外动作拓展已就绪');
  const sec = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8').replace(/^\uFEFF/, '')).worlds?.[WORLD];
  verdict = mine ? (sec?.enabled ? 'mounted' : 'listed-not-enabled') : 'not-loaded';
} catch { /* 保持 unknown */ }

const say = {
  mounted: '已加载并启用 —— 侧栏里应该有它，面板也能用。',
  'listed-not-enabled': '已经被加载了，但还没启用：在侧栏「World 扩展」里把它打开。',
  'not-loaded': '没有被加载：Coopanion 还没重启过（或者重启后导入失败，看上面几行）。',
  install: '安装有问题，先按 README 的安装步骤重来。',
  unknown: '状态不明，看上面逐条结果。',
}[verdict];
console.log(`\n结论：${say}`);
