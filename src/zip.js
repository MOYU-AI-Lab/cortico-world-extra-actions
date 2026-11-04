/**
 * 最小 ZIP 读取器（只用 node:zlib，无第三方依赖）。
 *
 * 只做我们需要的两件事：
 *   - listZip(buf)：列出条目（名字 / 大小 / 压缩方法）
 *   - extractZip(buf, { dest, onFile })：把条目解出来（支持 store 与 deflate）
 *
 * 安全约束（外部下载来的包不可信）：
 *   - 拒绝绝对路径、`..`、盘符、反斜杠归一化；
 *   - 只允许 `onFile` 返回 true 的路径落盘；
 *   - 单条目有大小上限，防 zip 炸弹（声明大小与实际都要看）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const MAX_ENTRY_BYTES = 128 * 1024 * 1024;

/** 找到 End of Central Directory（从尾部往前扫，注释最长 64K）。 */
function eocdOffset(buf) {
  const min = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error('不是合法的 zip（找不到目录结尾）');
}

/** 列出条目。 */
export function listZip(buf) {
  const eocd = eocdOffset(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== SIG_CENTRAL) throw new Error('zip 目录损坏');
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const rawSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const nameBuf = buf.subarray(off + 46, off + 46 + nameLen);
    const name = nameBuf.toString(flags & 0x800 ? 'utf8' : 'utf8');
    out.push({ name, method, compSize, rawSize, localOff, utf8: !!(flags & 0x800) });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 路径安全检查：返回规范化后的相对路径；不安全的条目返回 null（整条丢掉，不阻断其它正常文件）。 */
export function safeZipPath(name) {
  const clean = String(name).replace(/\\/g, '/');
  if (!clean || clean.endsWith('/')) return null;               // 目录条目
  if (clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) return null;   // 绝对路径
  const parts = clean.split('/');
  if (parts.some((p) => p === '..' || p === '' || p === '.')) return null; // 越界
  if (/[<>:"|?*\x00-\x1f]/.test(clean)) return null;            // 非法字符
  return parts.join('/');            // 统一正斜杠：调用方（过滤器）按 posix 写更直观
}

/**
 * 解压。
 * @param {Buffer} buf
 * @param {{ dest: string, onFile?: (rel: string, entry: {rawSize:number, compSize:number}) => boolean }} o
 */
export function extractZip(buf, { dest, onFile = () => true, mapPath = null }) {
  const entries = listZip(buf);
  const files = [];
  let skipped = 0;
  for (const e of entries) {
    let rel = safeZipPath(e.name);
    if (!rel) continue;                                        // 目录/不安全
    if (mapPath) rel = mapPath(rel);
    if (!rel) continue;
    if (!onFile(rel, e)) { skipped++; continue; }
    if (e.rawSize > MAX_ENTRY_BYTES) throw new Error(`条目太大：${e.name}（${e.rawSize}）`);
    if (e.method !== 0 && e.method !== 8) throw new Error(`不支持的压缩方式 ${e.method}：${e.name}`);

    const lh = e.localOff;
    if (buf.readUInt32LE(lh) !== SIG_LOCAL) throw new Error(`本地头损坏：${e.name}`);
    const nameLen = buf.readUInt16LE(lh + 26);
    const extraLen = buf.readUInt16LE(lh + 28);
    const start = lh + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + e.compSize);
    const raw = e.method === 0 ? Buffer.from(data) : inflateRawSync(data);
    if (raw.length > MAX_ENTRY_BYTES) throw new Error(`解出来太大：${e.name}`);

    const full = join(dest, ...rel.split('/'));
    if (!full.startsWith(normalize(dest + sep))) throw new Error(`越界：${e.name}`);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, raw);
    files.push(rel);
  }
  return { files, skipped, total: entries.length };
}
