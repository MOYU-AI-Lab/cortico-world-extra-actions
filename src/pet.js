/** Coopanion 本地桌宠服务的最小客户端（127.0.0.1:7797-7806）。 */

const PORTS = Array.from({ length: 10 }, (_, i) => 7797 + i);
let origin = null;

const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, bad) => setTimeout(() => bad(new Error(`pet server timeout (${ms}ms)`)), ms)),
]);

export async function findPet() {
  if (origin) return origin;
  for (const port of PORTS) {
    try {
      const r = await withTimeout(fetch(`http://127.0.0.1:${port}/api/state`), 700);
      if (r.ok) { origin = `http://127.0.0.1:${port}`; return origin; }
    } catch { /* 下一个端口 */ }
  }
  throw new Error('没找到 Coopanion 桌宠服务（7797-7806）');
}

export async function petState() {
  const base = await findPet();
  const r = await fetch(`${base}/api/state`);
  if (!r.ok) throw new Error(`读取桌宠状态失败：${r.status}`);
  return r.json();
}

/** 已安装的形象包（Coo 内置的排在最前，`removable` 的才是能往里写的）。 */
export async function petFigures() {
  const base = await findPet();
  const r = await fetch(`${base}/api/figures`);
  if (!r.ok) throw new Error(`读取形象包列表失败：${r.status}`);
  const list = await r.json();
  return Array.isArray(list) ? list : [];
}

/* 这个文件是只读的：不提供 /api/skin，也就改不了桌宠的形象与配色。
   换形象、让形象重新加载，都请到 Coopanion 的装扮页自己点 —— 那是用户的界面。 */
