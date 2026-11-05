/**
 * 行内预览（PR #1 带来的 preview 方法）的安全与行为测试。
 *   node test_preview.mjs
 *
 * 覆盖：正常返回 data URL、按 id#大小 命中缓存、非法 id、库里没有、
 * 老格式（只有 f_NNNN.webp）明确报不支持、符号链接拒绝、超大文件拒绝。
 */
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const W = await import(pathToFileURL(join(here, '..', 'src', 'world.js')).href);

const fails = [];
const check = (fn, msg) => { try { fn(); console.log('ok  ' + msg); } catch (e) { fails.push(`${msg} → ${e.message}`); console.log('FAIL ' + msg); } };
const bad = async (fn, re, msg) => {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  try {
    if (!err) throw new Error('应该抛错但没有');
    if (re && !re.test(String(err.message))) throw new Error(`错误信息不匹配：${err.message}`);
    console.log('ok  ' + msg);
  } catch (e) { fails.push(`${msg} → ${e.message}`); console.log('FAIL ' + msg); }
};

const root = join(here, '_tmp-preview');
rmSync(root, { recursive: true, force: true });
const dataDir = join(root, 'data');
const lib = join(root, 'lib');
mkdirSync(dataDir, { recursive: true });

const mk = (cat, id, files) => {
  const d = join(lib, 'actions', cat, id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'action.json'), JSON.stringify({
    id, category: cat, word: id, zh: id, say: id, clip: `actions/${cat}/${id}`,
    frames: 2, fps: 24, seconds: 1, anim: files.anim === true,
  }), 'utf8');
  if (files.anim) writeFileSync(join(d, 'anim.webp'), 'RIFFxxxxWEBPVP8 ', 'utf8');
  if (files.frames) for (let i = 1; i <= 2; i++) writeFileSync(join(d, `f_${String(i).padStart(4, '0')}.webp`), 'x', 'utf8');
  return d;
};

mk('core', 'cheer-hop', { anim: true });
mk('core', 'old-format', { frames: true });      // 只有帧序列
mk('core', 'huge', { anim: true });

const cfg = { libraryDir: lib };
const w = new W.ExtraActionsWorld({ ctx: { dataDir, cfg, botDir: join(root, 'bot'), persist: (p) => Object.assign(cfg, p), packageDir: join(here, '..'), repoRoot: here } });

const pv = await w.invoke('picker', 'preview', ['cheer-hop']);
check(() => { if (!pv.dataUrl?.startsWith('data:image/webp;base64,')) throw new Error('不是 webp data URL'); }, '正常返回 data URL');
check(() => { if (pv.cached !== false) throw new Error('第一次不该是缓存'); }, '第一次读盘 cached=false');
const pv2 = await w.invoke('picker', 'preview', ['cheer-hop']);
check(() => { if (pv2.cached !== true) throw new Error('第二次应该是缓存'); }, '第二次命中缓存 cached=true');

await bad(() => w.invoke('picker', 'preview', ['../etc/passwd']), /id 不合法/, '路径穿越被 id 白名单拦住');
await bad(() => w.invoke('picker', 'preview', ['CHEER-HOP']), /id 不合法/, '大写 id 被拒');
await bad(() => w.invoke('picker', 'preview', ['nope-xyz']), /库里没有/, '库里没有这一段');

/* 老格式：只有 f_NNNN.webp */
await bad(() => w.invoke('picker', 'preview', ['old-format']), /没有 anim\.webp|不支持/, '老格式帧序列明确报不支持');

/* 超大文件 */
{
  const big = join(lib, 'actions', 'core', 'huge', 'anim.webp');
  writeFileSync(big, Buffer.alloc(13 * 1024 * 1024, 1));
  await bad(() => w.invoke('picker', 'preview', ['huge']), /超过预览上限/, '超过 12 MB 拒绝回传');
}

/* 符号链接（Windows 可能需要权限，失败就跳过） */
try {
  const target = join(root, 'outside.webp');
  writeFileSync(target, 'RIFFxxxxWEBPVP8 ', 'utf8');
  const dir = join(lib, 'actions', 'core', 'link-test');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'action.json'), JSON.stringify({ id: 'link-test', category: 'core', word: 'link-test', zh: 'x', say: 'x', clip: 'actions/core/link-test', frames: 2, fps: 24, seconds: 1, anim: true }), 'utf8');
  symlinkSync(target, join(dir, 'anim.webp'));
  await bad(() => w.invoke('picker', 'preview', ['link-test']), /没有 anim\.webp|不支持/, '符号链接被拒绝');
} catch (e) {
  console.log('跳过符号链接用例（没有创建权限）:', String(e.message).slice(0, 60));
}

rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
