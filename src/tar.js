/**
 * 最小 tar.gz 读取器（只用 node:zlib）。
 *
 * npm 包的 tarball 就是 tar.gz —— 动作库按 npm 包分发时得能解它。
 * 安全约束与 zip 那边一致：不安全路径整条丢掉，只允许 onFile 认的文件落盘。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { safeZipPath } from './zip.js';

const MAX_ENTRY_BYTES = 128 * 1024 * 1024;

const str = (buf, from, to) => buf.toString('utf8', from, to).replace(/\0[\s\S]*$/, '');

/**
 * @param {Buffer} buf  .tgz
 * @param {{ dest: string, onFile?: (rel: string) => boolean, mapPath?: (rel: string) => string|null }} o
 */
export function extractTarGz(buf, { dest, onFile = () => true, mapPath = null }) {
  const tar = gunzipSync(buf);
  const files = [];
  let skipped = 0;
  let off = 0;
  const root = normalize(dest + sep);

  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;                        // 结束块
    const name = str(h, 0, 100);
    const prefix = str(h, 345, 500);
    const sizeStr = str(h, 124, 136).trim();
    const size = sizeStr ? parseInt(sizeStr, 8) : 0;
    const type = h[156] === 0 ? 0x30 : h[156];
    off += 512;

    if (type === 0x30 && Number.isFinite(size) && size >= 0) {
      let rel = safeZipPath(prefix ? `${prefix}/${name}` : name);
      if (rel) {
        if (mapPath) rel = mapPath(rel);
        if (rel && onFile(rel)) {
          if (size > MAX_ENTRY_BYTES) throw new Error(`条目太大：${rel}`);
          const full = join(dest, ...rel.split('/'));
          if (!normalize(full).startsWith(root)) throw new Error(`越界：${rel}`);
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, tar.subarray(off, off + size));
          files.push(rel);
        } else skipped++;
      } else skipped++;
    }
    off += Math.ceil(size / 512) * 512;
  }
  return { files, skipped };
}
