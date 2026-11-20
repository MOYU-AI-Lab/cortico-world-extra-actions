/** Coopanion 本地桌宠服务的最小客户端（127.0.0.1:7797-7806）。 */

const DEFAULT_PORTS = Array.from({ length: 10 }, (_, i) => 7797 + i);
/** 自测 / 隔离模拟：COOPANION_PET_OFF=1 彻底不探；COOPANION_PET_PORTS=7797,7798 指定端口。 */
const PORTS = (() => {
  const raw = process.env.COOPANION_PET_PORTS;
  if (!raw) return DEFAULT_PORTS;
  const list = raw.split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0 && x < 65536);
  return list.length ? list : DEFAULT_PORTS;
})();
const PET_OFF = process.env.COOPANION_PET_OFF === '1';
let origin = null;

const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, bad) => setTimeout(() => bad(new Error(`pet server timeout (${ms}ms)`)), ms)),
]);

export async function findPet() {
  if (PET_OFF) throw new Error('COOPANION_PET_OFF=1（自测模式，不连桌宠）');
  if (origin) return origin;
  for (const port of PORTS) {
    try {
      const r = await withTimeout(fetch(`http://127.0.0.1:${port}/api/state`), 700);
      if (r.ok) { origin = `http://127.0.0.1:${port}`; return origin; }
    } catch { /* 下一个端口 */ }
  }
  throw new Error('没找到 Coopanion 桌宠服务（7797-7806）');
}

/**
 * 连不上就把缓存的端口丢掉再找一次。
 *
 * 以前 origin 一旦定下就永不过期：桌宠重启、换了端口（7797→7798），
 * 插件会一直往旧端口发请求、永远失败 —— 用户看到的就是「我保存了但它毫无反应」。
 */
async function retryOnce(fn) {
  try {
    return await fn();
  } catch (e) {
    const why = String(e?.message ?? '');
    if (!/fetch failed|ECONNREFUSED|ENOTFOUND|没找到|timeout/i.test(why)) throw e;
    origin = null;
    return fn();
  }
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

/* 这里不提供"改形象"的能力：没有对外可传的 figure 参数，也没有切换皮肤的入口。
   换形象、改配色仍然只能由用户在 Coopanion 的装扮页自己做。

   唯一的写操作是 petReload()：把**当前**形象原样回填一次，等价于「在装扮页重新点一下
   这个形象」，用来让桌宠重新加载刚写好的动作表。它只用 /api/state 的现值，
   不接受任何外部传入的形象 id / 配色，所以改不了用户的东西。 */

/** 重新加载当前形象（幂等）。桌宠没开就抛错，由调用方决定怎么提示。 */
export async function petReload() {
  return retryOnce(async () => {
    const base = await findPet();
    const r0 = await withTimeout(fetch(`${base}/api/state`), 2000);
    if (!r0.ok) throw new Error(`读取桌宠状态失败：${r0.status}`);
    const st = await r0.json();
    const s = st?.skin ?? {};
    if (!s.figure) throw new Error('桌宠当前没有形象，跳过重载');
    const r = await withTimeout(fetch(`${base}/api/skin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // 注意：这个接口要的是 { skin: {...} }，不是扁平字段。
      // 早先发扁平字段时服务端读到的是 undefined，HTTP 照样 200 —— 等于静默空操作。
      // 这里整份 /api/state 的 skin 原样回填，一个字段都不改。
      body: JSON.stringify({ skin: s }),
    }), 5000);
    if (!r.ok) throw new Error(`让桌宠重载失败：HTTP ${r.status}`);
    return { ok: true, figure: s.figure };
  });
}
