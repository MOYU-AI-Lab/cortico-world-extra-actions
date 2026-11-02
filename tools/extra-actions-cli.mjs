#!/usr/bin/env node
/**
 * 额外动作拓展 —— 命令行版（和面板走同一份 writer.js，写出来的东西一模一样）。
 *
 *   node tools/extra-actions-cli.mjs list
 *   node tools/extra-actions-cli.mjs state
 *   node tools/extra-actions-cli.mjs save --pack shenshen-actions --ids eat-dumplings,fireworks
 *   node tools/extra-actions-cli.mjs save --pack shenshen-actions --paths   # 直接给包目录也能用
 *   node tools/extra-actions-cli.mjs clear --pack shenshen-actions
 *
 * 不给 --pack 时用当前桌宠在用的形象；不给 --list 时按 --ids 覆盖式保存（取消的会被删掉）。
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const worldMod = await import(pathToFileURL(join(here, '..', 'src', 'index.js')).href);
const { petFigures, petState } = await import(pathToFileURL(join(here, '..', 'src', 'pet.js')).href);

const argv = process.argv.slice(2);
const cmd = argv[0] || 'state';
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

/** dataDir：--data 或环境变量 COOPANION_DATA；都没有就报用法，不猜。 */
async function world() {
  const explicit = opt('data') || process.env.COOPANION_DATA || '';
  if (!explicit) throw new Error('需要 --data <...\\home\\companion\\data>（或环境变量 COOPANION_DATA）');
  if (!existsSync(explicit)) throw new Error(`数据目录不存在：${explicit}`);
  const w = worldMod.default.create({ dataDir: explicit, cfg: {} });
  if (!existsSync(join(w.figuresDir(), '..'))) {
    throw new Error(`不像 Coopanion 的数据目录（没有 figures 上级目录）：${explicit}`);
  }
  return w;
}

const w = await world();

if (cmd === 'list') {
  const cat = await w.invoke('picker', 'catalog');
  const byCat = new Map();
  for (const a of cat.actions) {
    if (!byCat.has(a.category)) byCat.set(a.category, []);
    byCat.get(a.category).push(a);
  }
  for (const [cid, rows] of byCat) {
    console.log(`\n## ${rows[0].catZh}（${cid}） — ${rows.length}`);
    for (const a of rows) {
      console.log(`  ${a.id.padEnd(20)} ${a.zh.padEnd(14)} ${String(a.frames).padStart(3)}f ${a.seconds.toFixed(2)}s${a.word ? '' : '  [状态]'}`);
    }
  }
  console.log(`\n${cat.count} 个动作，${cat.words} 个可点名`);
} else if (cmd === 'state') {
  const st = await w.invoke('picker', 'state');
  console.log('形象包目录:', st.figuresDir);
  console.log('动作库    :', st.library.ok ? st.library.dir : `(未设置) ${st.library.dir}`);
  console.log('当前形象  :', st.current ?? '(桌宠没开)');
  for (const f of st.figures) {
    const mark = f.current ? '*' : ' ';
    const sup = f.supported ? '可加' : '不支持';
    console.log(` ${mark} ${f.id.padEnd(20)} ${String(f.name).padEnd(12)} ${sup}  已装 ${f.extra.count} 段`);
  }
  if (st.installed) console.log('\n写入位置:', st.installed.root, st.installed.ok ? '' : `（${st.installed.problems.join('；')}）`);
} else if (cmd === 'save') {
  const ids = (opt('ids', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error('缺少 --ids（逗号分隔的模块 id，先用 list 看）');
  let packId = opt('pack');
  if (!packId) packId = (await petState().catch(() => null))?.skin?.figure;
  if (!packId) throw new Error('缺少 --pack，而且不知道当前形象');
  const r = await w.invoke('picker', 'save', [packId, ids]);
  console.log(`已写入 ${packId}：${r.count} 段，${(r.bytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  新拷 ${r.copied.length}，已存在 ${r.skipped.length}，取消 ${r.removed.length}，词 +${r.vocab.added.length} -${r.vocab.removed.length}`);
  console.log('  重启 Coopanion 后 bot 才能点名这些词；画面部分重新加载形象即可生效。');
} else if (cmd === 'add') {
  const dir = opt('dir');
  if (!dir) throw new Error('需要 --dir <动作文件夹>');
  const r = await w.invoke('picker', 'add', [dir]);
  const list = r.added.map((a) => `${a.zh}(${a.id}, ${a.frames} 帧)`).join('、');
  console.log(`加入 ${r.added.length} 个动作${list ? '：' + list : ''}`);
  if (r.skipped.length) console.log('跳过：' + r.skipped.map((s) => `${s.dir}: ${s.reason}`).join('；'));
  console.log(`动作库现在共 ${r.total} 个动作`);
} else if (cmd === 'set-library') {
  const dir = opt('dir');
  if (!dir) throw new Error('需要 --dir <动作库目录>');
  const r = await w.invoke('picker', 'set-library', [dir]);
  console.log('动作库已指向:', r.libraryDir);
} else if (cmd === 'reindex') {
  const r = await w.invoke('picker', 'reindex', []);
  console.log(`已重建 actions/index.js：${r.count} 条${r.changed ? '（有改动）' : '（无变化）'}`);
} else if (cmd === 'prune') {
  const packId = opt('pack');
  if (!packId) throw new Error('需要 --pack');
  const r = await w.invoke('picker', 'prune', [packId]);
  console.log(`已压缩 ${packId}：删掉 ${r.removed.length} 个模块，省出 ${(r.freed / 1048576).toFixed(1)} MB；包里现在 ${(r.left / 1048576).toFixed(1)} MB`);
} else if (cmd === 'remove') {
  const packId = opt('pack');
  const id = opt('id');
  if (!packId || !id) throw new Error('需要 --pack 和 --id');
  const r = await w.invoke('picker', 'remove', [packId, id]);
  console.log(`已删除 ${r.removed}（还剩 ${r.remaining} 段${r.cleared ? '，词表已还原' : ''}）`);
} else if (cmd === 'clear') {
  let packId = opt('pack');
  if (!packId) packId = (await petState().catch(() => null))?.skin?.figure;
  const r = await w.invoke('picker', 'clear', [packId]);
  console.log(`已清空 ${packId}：删掉 ${r.removed} 个模块，` + (r.vocab.restored ? "figure.json 的词表已还原成勾选前的样子" : `撤掉 ${r.vocab.removed.length} 个词`));
} else {
  console.log('用法: list | state | save --pack <id> --ids a,b | remove --pack <id> --id <x> | add --dir <path> | prune --pack <id> | reindex | set-library --dir <path> | clear --pack <id>');
  process.exitCode = 1;
}
