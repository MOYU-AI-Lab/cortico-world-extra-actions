/**
 * 形象包清单体检：把 figure.json 按宿主 readManifest() 的规则过一遍。
 *   node manifest-check.mjs <形象包目录> [更多目录…]
 *
 * 宿主（cortico-world-desktop-pet/packs.ts）对清单是「一条不合格 → 整个包不加载」，
 * 界面上就表现为"形象列表里没有这个包"，还会让人以为可以再建一个。
 * 这里把最容易踩的几条静态查出来：
 *   - manifest / api 的范围
 *   - id / entry / export / thumb
 *   - axes：id、name、options[].id 与 name
 *   - presets：**必须有 pick 对象**，且 pick 要覆盖每个 axis、值必须是该 axis 的某个 option
 *   - vocab / sounds 交给 doctor.mjs 的词表检查
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const OPTION_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const NAME_BREAK = /[,，、\s【】<>＜＞]/;

const namesOf = (v) => (v && typeof v === 'object' ? Object.values(v).some((x) => typeof x === 'string' && x.trim()) : false);

export function checkManifest(dir) {
  const file = join(dir, 'figure.json');
  if (!existsSync(file)) return [`没有 figure.json`];
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return [`figure.json 不是合法 JSON：${e.message}`]; }
  const out = [];
  for (const [key, oldest, now] of [['manifest', 1, 2], ['api', 1, 2]]) {
    const v = raw[key];
    if (typeof v !== 'number' || !Number.isInteger(v)) { out.push(`${key} 不是整数：${JSON.stringify(v)}`); continue; }
    if (v > now) out.push(`${key} 比宿主新（${v} > ${now}）`);
    if (v < oldest) out.push(`${key} 太老（${v} < ${oldest}）`);
  }
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) out.push(`id 不合法：${JSON.stringify(raw.id)}`);
  if (!namesOf(raw.name)) out.push('缺 name');
  if (!namesOf(raw.about)) out.push('缺 about');
  if (typeof raw.entry !== 'string' || !raw.entry) out.push('缺 entry');
  if (typeof raw.export !== 'string' || !raw.export) out.push('缺 export');
  if (typeof raw.entry === 'string' && raw.entry) {
    const entryFile = join(dir, raw.entry);
    if (!existsSync(entryFile)) out.push(`entry 指向的文件不存在：${raw.entry}`);
    else if (typeof raw.export === 'string' && raw.export) {
      const js = readFileSync(entryFile, 'utf8');
      const exported = new Set([
        ...[...js.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]),
        ...[...js.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]),
        ...[...js.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop())),
      ].filter(Boolean));
      if (!exported.has(raw.export)) out.push(`export="${raw.export}" 在 ${raw.entry} 里没有导出（宿主会加载失败）`);
    }
  }

  // thumb 指的文件也要在（封面裂图就是这么来的）
  if (raw.thumb !== undefined) {
    if (typeof raw.thumb !== 'string' || !raw.thumb) out.push('thumb 不是字符串');
    else if (!existsSync(join(dir, raw.thumb))) out.push(`thumb 指向的文件不存在：${raw.thumb}`);
  }

  const axes = [];
  for (const a of Array.isArray(raw.axes) ? raw.axes : []) {
    if (typeof a?.id !== 'string' || !ID.test(a.id)) { out.push(`axis id 不合法：${JSON.stringify(a?.id)}`); continue; }
    if (!namesOf(a?.name)) { out.push(`axis "${a.id}" 缺 name`); continue; }
    if (!Array.isArray(a?.options) || !a.options.length) { out.push(`axis "${a.id}" 没有 options`); continue; }
    const ids = [];
    for (const o of a.options) {
      if (typeof o?.id !== 'string' || !OPTION_ID.test(o.id)) { out.push(`axis "${a.id}" 的 option id 不合法：${JSON.stringify(o?.id)}`); continue; }
      if (!namesOf(o?.name)) out.push(`axis "${a.id}" 的 option "${o.id}" 缺 name`);
      ids.push(o.id);
    }
    axes.push({ id: a.id, ids });
  }

  for (const p of Array.isArray(raw.presets) ? raw.presets : []) {
    if (typeof p?.id !== 'string' || !ID.test(p.id)) { out.push(`preset id 不合法：${JSON.stringify(p?.id)}`); continue; }
    // ← 这一条最容易被忽略：少了 pick，整个包都不加载
    if (!p.pick || typeof p.pick !== 'object') { out.push(`preset "${p.id}" 缺 pick（宿主会拒绝整个包）`); continue; }
    for (const a of axes) {
      const v = p.pick[a.id];
      if (!a.ids.includes(v)) out.push(`preset "${p.id}" 没给 axis "${a.id}" 选一个合法 option（现在是 ${JSON.stringify(v)}）`);
    }
    if (p.name !== undefined && !namesOf(p.name)) out.push(`preset "${p.id}" 的 name 不合法`);
    if (p.console !== undefined) {
      if (typeof p.console !== 'object' || !p.console) out.push(`preset "${p.id}" 的 console 不是对象`);
      else for (const mode of ['light', 'dark']) {
        const pal = p.console[mode];
        if (!pal || typeof pal !== 'object') { out.push(`preset "${p.id}" 的 console.${mode} 缺失`); continue; }
        for (const k of ['a', 'a2', 'on', 't', 'c3', 'c4']) {
          if (typeof pal[k] !== 'string' || !/^#[0-9a-f]{6}$/i.test(pal[k])) out.push(`preset "${p.id}" 的 console.${mode}.${k} 不是 #rrggbb`);
        }
      }
    }
  }
  /* vocab：宿主的 readVocab 也是一票否决（一条不合格 → 整份词表作废 → bot 一个词都认不出） */
  const NAME_BREAK_V = /[,，、\s【】<>＜＞]/;
  const taken = new Set();
  for (const w of Array.isArray(raw.vocab) ? raw.vocab : []) {
    const id = String(w?.id ?? '');
    if (!ID.test(id)) { out.push(`vocab id 不合法：${JSON.stringify(w?.id)}`); continue; }
    for (const list of Object.values(w?.names ?? {})) {
      for (const n of Array.isArray(list) ? list : []) {
        if (typeof n !== 'string' || !n.trim() || n.length > 32 || NAME_BREAK_V.test(n)) out.push(`vocab "${id}" 的名字不合法：${JSON.stringify(n)}`);
      }
    }
    for (const n of [id, ...Object.values(w?.names ?? {}).flat()]) {
      if (taken.has(n)) out.push(`vocab 名字重复：${n}（宿主会拒掉整份词表）`);
      taken.add(n);
    }
    if (!w?.about || typeof w.about !== 'object' || !Object.values(w.about).some((v) => typeof v === 'string' && v.trim())) out.push(`vocab "${id}" 缺 about`);
    if (typeof w?.seconds !== 'number' || !(w.seconds > 0)) out.push(`vocab "${id}" 的 seconds 不合法`);
  }

  return out;
}

/* CLI */
if (process.argv[1] && process.argv[1].endsWith('manifest-check.mjs')) {
  const dirs = process.argv.slice(2).map((d) => resolve(d));
  if (!dirs.length) { console.error('用法: node manifest-check.mjs <形象包目录> …'); process.exit(2); }
  let bad = 0;
  for (const d of dirs) {
    const errs = checkManifest(d);
    console.log(`\n${d}`);
    if (!errs.length) console.log('  ✅ 清单合规');
    else { bad++; for (const e of errs) console.log('  · ' + e); }
  }
  process.exit(bad ? 1 : 0);
}
