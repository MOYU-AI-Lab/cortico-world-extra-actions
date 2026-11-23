/**
 * 深深·动作库 —— 通用动作播放器（Coopanion 形象包 body api 2）。
 *
 * 这个文件不认识任何具体动作：动作全在 `actions/index.js`（以及可选的 `额外动作拓展/index.js`）里，
 * 每条对应一个自足的模块目录。想加一个动作：拷目录 + 加一行清单。想删就删那一行。
 *
 * 契约：`figure-frame.js` 调 `factory(base, { model, scheme, kit, loadImage, asset, host })`，
 * 返回带 step / layout / do 的 body。本文件用 kit.createBody 包一个只会画帧的 figure。
 *
 * 画面怎么放（两条路，都保持 SVG `<image>` 的透明）：
 * - 默认 `blob:` 缓存：每帧只 fetch 一次，换成同源 blob URL 再换 `href`。
 *   服务端给帧的是 `cache-control: no-cache` 且没有 ETag，直接换真地址等于每帧重新下载；
 *   换 blob URL 之后播放时不再出网，透明和抗锯齿与原来一致。
 * - fetch 被 CSP 挡住时自动退回"逐帧换真地址"，功能不受影响，只是会多走网络。
 *
 * 为什么不用 canvas：把 `<canvas>` 塞进 `<foreignObject>` 在这套透明桌宠窗口里会被合成成黑块，
 * 画面直接废掉 —— 宁可多花几次解码也不能动显示。
 *
 * 计时：所有时长都以 kit 递进来的 `o.t`（从 body 创建起算的秒）作基准，
 * **不要**用 performance.now() —— kit 的 T 从 0 起算，页面时钟不是，混用会让动作永远结束不了。
 */

const SVGNS = 'http://www.w3.org/2000/svg';
/** 片段的播放帧率：素材是 24 fps，这里写死，不随窗口帧率变化。 */
const PLAY_FPS = 24;
/** 被拎起来时的播放帧率：拖动要跟手，所以单独提一档。 */
const DRAG_FPS = 60;
const FPS_DEFAULT = PLAY_FPS;
/** 素材的人物框（帧像素）：x0, y0, x1, y1。所有模块共用同一套构图。 */
const BODY = [212, 60, 428, 330];
const CANVAS_W = 640, CANVAS_H = 360;
const K = 256 / (BODY[3] - BODY[1]);
const IMG_W = CANVAS_W * K;
const IMG_H = CANVAS_H * K;
const IMG_X = 128 - ((BODY[0] + BODY[2]) / 2) * K;
const IMG_Y = 256 - BODY[3] * K;

/** 待机多久后第一次插小动作、之后每隔多久、一段小动作结束后静一会儿。 */
const VARIETY_FIRST_MS = 4500;
const VARIETY_GAP_MS = 6000;
/** 两次点击反应的最短间隔（毫秒）。 */
const CLICK_GAP_MS = 400;
/** 没勾点击回应时退回去用的那几个动作词。 */
const CLICK_FALLBACK = new Set(['cheer-wave', 'cheer-hop', 'tickle-giggle', 'shy-startle', 'tsun-pout']);
/** 点击回应最多播这么久就回待机：反应本来就该短促，10 秒的整段留着轮播用。 */
const REACTION_MAX = 2.6;
/** 关掉 blob 预取（退回逐帧换真地址），只在排查问题时用。 */
const NO_BLOB_CACHE = false;
/** 每帧之后往前预取几张。 */
const PREFETCH = 12;

const modeOf = (o) => String(o?.mode ?? o?.pet?.mode ?? o?.state?.mode ?? '');

/**
 * 读 `actions/index.js`，再并上可选的 `额外动作拓展/index.js`（后者同名词覆盖前者）。
 * 两个都没有就报清楚 —— 免得一个空动作表被当成"正常加载"。
 */
async function loadIndex(base) {
  const tryLoad = async (rel) => {
    try {
      const mod = await import(new URL(rel, base).href);
      const list = mod?.default;
      if (!Array.isArray(list)) return null;
      return list.filter((e) => e && typeof e.clip === 'string' && (typeof e.id === 'string' || typeof e.word === 'string'));
    } catch {
      return null;
    }
  };
  const baseList = await tryLoad('actions/index.js');
  const extraList = await tryLoad('额外动作拓展/index.js');
  if (!baseList && !extraList) throw new Error('这个包里既没有 actions/index.js 也没有 额外动作拓展/index.js');
  const merged = [...(baseList ?? [])];
  for (const e of extraList ?? []) {
    const i = e.word ? merged.findIndex((x) => x.word === e.word) : -1;
    if (i >= 0) merged[i] = e; else merged.push(e);
  }
  // 有 额外动作拓展 就是"勾选即全部"：那份清单是许可名单，没进去的动作不再自己冒出来。
  const allow = (extraList ?? []).map((e) => e.word).filter(Boolean);
  return { list: merged, allow: allow.length ? new Set(allow) : null };
}

/**
 * 入口。导出名必须与 figure.json 的 `export` 一致（createActionBody）。
 */
export async function createActionBody(base, opts) {
  const baseUrl = new URL(base);
  const { list, allow } = await loadIndex(baseUrl);
  const fig = createFigure(baseUrl, list, allow);
  const body = opts.kit.createBody(opts.host, { figure: fig });

  /* ---------- 跑步起步：先原地迈出第一步，再真跑（2026-11-21） ----------
     kit 的位移由 body.walk / do('run') 触发；这里把"跑"压后 RUN_HOLD_MS，
     期间用 holdRun 原地播跑片段（例如螃蟹走路）的起步段 —— 观感是"先迈一步 → 再开始真跑"。
     走（run=false）与其它动作不受影响。绑在播放器里，不依赖 Coopanion 运行库补丁。 */
  const RUN_HOLD_MS = 420;
  const origWalk = typeof body.walk === 'function' ? body.walk.bind(body) : null;
  const origStopWalk = typeof body.stopWalk === 'function' ? body.stopWalk.bind(body) : null;
  const emit = typeof opts.host?.emit === 'function' ? opts.host.emit.bind(opts.host) : null;
  let pendingRun = null;   // { gen, walkId }
  let runGen = 0;
  /** 开一段"原地迈步"；被新指令 / stop 顶掉时旧编号作废。 */
  const beginRunHold = () => {
    runGen += 1;
    if (pendingRun) { emit?.('interrupted', { walkId: pendingRun.walkId, by: 'superseded' }); pendingRun = null; }
    fig.holdRun(RUN_HOLD_MS / 1000 + .06);
    return { gen: runGen, walkId: 0 };
  };
  if (origWalk && fig.hasRunClip) {
    body.walk = (x, run, walkId) => {
      if (!run) return origWalk(x, run, walkId);
      pendingRun = beginRunHold();
      pendingRun.walkId = walkId;
      const gen = pendingRun.gen;
      setTimeout(() => {
        if (!pendingRun || pendingRun.gen !== gen) return;   // 被新的 walk / stop 顶掉
        const p = pendingRun; pendingRun = null;
        if (/drag|air|crouch/.test(fig.modeNow)) { emit?.('interrupted', { walkId: p.walkId, by: 'busy' }); return; }
        origWalk(x, true, p.walkId);
      }, RUN_HOLD_MS);
      return true;
    };
    body.stopWalk = (walkId) => {
      if (pendingRun && pendingRun.walkId === walkId) {
        pendingRun = null;
        emit?.('interrupted', { walkId, by: 'stop' });
        return;
      }
      return origStopWalk ? origStopWalk(walkId) : undefined;
    };
  }
  const kitDo = body.do?.bind(body);
  if (kitDo) {
    body.do = (word) => {
      if (word === 'run' && origWalk && fig.hasRunClip) {
        pendingRun = beginRunHold();
        const gen = pendingRun.gen;
        setTimeout(() => {
          if (!pendingRun || pendingRun.gen !== gen) return;
          pendingRun = null;
          if (/drag|air|crouch/.test(fig.modeNow)) return;
          fig.trigger(word);
          kitDo(word);
        }, RUN_HOLD_MS);
        return;
      }
      fig.trigger(word);
      kitDo(word);
    };
  }

  // 报给 World：词表里有、这里不认的词会被剔掉，所以这里必须是全量
  const words = new Set(Array.isArray(body.words) ? body.words : []);
  for (const w of fig.words) words.add(w);
  body.words = [...words];

  // 点击 = 一段点击回应。kit 的短按只换一张随机表情 + 小跳，而素材自带脸、这里不画，
  // 所以不接这一段的话，点她几乎什么都不会发生。
  const pointer = typeof body.pointer === 'function' ? body.pointer.bind(body) : null;
  if (pointer) {
    let pressAt = 0, pressX = 0, pressY = 0, lastAt = -1e9;
    body.pointer = (type, p) => {
      const now = performance.now();
      if (type === 'down' && p) { pressAt = now; pressX = p.x; pressY = p.y; }
      pointer(type, p);
      if (type !== 'up' || !p || !pressAt) return;
      const quick = now - pressAt < 400 && Math.hypot(p.x - pressX, p.y - pressY) <= 6;
      pressAt = 0;
      if (!quick || now - lastAt < CLICK_GAP_MS) return;
      lastAt = now;
      fig.react();
    };
  }
  return body;
}

function createFigure(base, index, allow = null) {
  /** clip -> 条目 */
  const byClip = new Map();
  /** word -> { clip, seconds } */
  const byWord = new Map();
  /** role -> clip */
  const byRole = new Map();
  /** 可被点击的 */
  const reactions = [];
  /** 待机轮播的 */
  const variety = [];
  for (const e of index) {
    byClip.set(e.clip, e);
    if (e.word) byWord.set(e.word, { clip: e.clip, seconds: number(e.seconds, number(e.frames, 241) / FPS_DEFAULT) });
    for (const r of Array.isArray(e.roles) ? e.roles : []) byRole.set(r, e.clip);
    const allowed = !allow || allow.has(e.word);
    if (e.reaction) reactions.push(e.word ?? e.id);
    if (e.random !== false && e.word && allowed) variety.push({ clip: e.clip, seconds: number(e.seconds, number(e.frames, 241) / FPS_DEFAULT) });
  }
  const idleClip = byRole.get('idle') ?? index[0]?.clip;
  const walkClip = byRole.get('walk') ?? idleClip;
  /** 跑：清单里写了 roles: ["run"] 的段；没写就跟走共用。 */
  const runClip = byRole.get('run') ?? walkClip;
  const dragClip = byRole.get('drag') ?? idleClip;
  const turnClip = byRole.get('turn') ?? idleClip;

  let img = null;
  let clip = idleClip;
  let frame = -1;
  let clock = 0;
  let last = -1;
  let shownHref = null;
  /** { clip, seconds, from }：一次性动作；from 落在 draw 的时钟上，第一帧才落值。 */
  let override = null;
  let flipOn = null;
  let varietyAt = -1;
  let varietyIdx = 0;
  let modeNow = '';
  /** 跑步起步占位到何时（performance.now() 毫秒）：这期间点击回应不顶掉起步动作。 */
  let holdUntil = 0;

  /* ---------- 帧来源：blob URL 缓存 ---------- */
  /** key -> objectURL（压缩后的一帧约 11 KB，241 帧也就 2.6 MB） */
  const urls = new Map();
  const loading = new Set();
  /** fetch 一旦被 CSP 拦下就永久退回真地址，别每帧都试一次。 */
  let blobOk = !NO_BLOB_CACHE;
  const keyOf = (c, i) => `${c}#${i}`;
  const framesOf = (c) => number(byClip.get(c)?.frames, 241);
  const urlOf = (c, i) => new URL(`${c}/f_${String(i + 1).padStart(4, '0')}.webp`, base).href;

  /* ---------- 单文件动画模块（高清单文件 anim.webp）----------
   * 目录里只要有 anim.webp，就只挂一个 <image> 让浏览器自己循环播放，
   * 不再逐帧换 href。高清动作库就是这种格式（640×360，一段一个文件）。 */
  const animUrlOf = (c) => new URL(`${c}/anim.webp`, base).href;
  /** clip -> 'pending' | 'yes' | 'no' */
  const animState = new Map();
  let animUrlNow = null;
  const probeAnim = (c) => {
    if (animState.has(c)) return;
    // 先记 pending：探测没回来时保持上一帧，别去请求不存在的 f_XXXX.webp（会闪白）
    animState.set(c, 'pending');
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => animState.set(c, 'yes');
    probe.onerror = () => animState.set(c, 'no');
    probe.src = animUrlOf(c);
  };
  // 已有显式标记的（清单里 anim: true）直接当单文件，省一次探测
  for (const [c, e] of byClip) if (e && e.anim === true) animState.set(c, 'yes');

  function releaseClip(keepClip) {
    for (const [k, u] of urls) {
      if (k.startsWith(keepClip + '#')) continue;
      try { URL.revokeObjectURL(u); } catch { /* 没有就算了 */ }
      urls.delete(k);
    }
    shownHref = null;
  }

  /** 取一帧的 blob URL；失败就永久退回真地址。 */
  function load(c, i) {
    if (!blobOk) return;
    const key = keyOf(c, i);
    if (urls.has(key) || loading.has(key)) return;
    loading.add(key);
    fetch(urlOf(c, i))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        loading.delete(key);
        if (!key.startsWith(clip + '#')) return;      // 片段已经换掉，别留着
        try { urls.set(key, URL.createObjectURL(b)); } catch { blobOk = false; }
      })
      .catch(() => {
        loading.delete(key);
        blobOk = false;                                // 退回逐帧换真地址
      });
  }

  function prefetch(c, from, n) {
    const total = framesOf(c);
    for (let k = 0; k < n; k++) load(c, (from + k) % total);
  }

  /** cap：最多播几秒（点击回应用 REACTION_MAX，别的调用不传 = 播完整段）。 */
  const play = (word, cap = Infinity) => {
    const c = byWord.get(word);
    if (!c) return false;
    override = { clip: c.clip, seconds: Math.min(c.seconds, cap), from: -1, kind: 'word' };
    return true;
  };

  return {
    /** kit 用的锚点（z 字、爱心、视线、气泡），logo 单位。 */
    get anchors() {
      return { gaze: [128, 96], tear: [112, 128], tears: [[108, 128], [148, 128]], z: [150, 60], hearts: [96, 176, 62], bubble: [128, 18] };
    },
    get extent() {
      return [128 - ((BODY[0] + BODY[2]) / 2 - BODY[0]) * K, 0, 128 + (BODY[2] - (BODY[0] + BODY[2]) / 2) * K, 256];
    },
    get hits() {
      return [[128, 200, 56], [128, 130, 46]];
    },
    /** 调试/自测用。 */
    get clip() { return clip; },
    get modeNow() { return modeNow; },
    /** 清单里有没有写 roles:["run"] 的段（有才做"先迈一步再跑"）。 */
    get hasRunClip() { return byRole.has('run'); },
    get words() { return [...byWord.keys()]; },
    get actions() { return index; },
    /** 自测用：缓存了几帧、还有几帧在路上、fetch 还能不能用。 */
    get stats() { return { cached: urls.size, loading: loading.size, blob: blobOk, frames: framesOf(clip), fps: PLAY_FPS }; },

    trigger(word) { return play(word); },

    /** 跑步起步占位：原地播放 run 片段一段时间（不产生位移），由 body.walk 包装器调用。 */
    holdRun(seconds) {
      if (!runClip) return;
      override = { clip: runClip, seconds, from: -1, kind: 'word' };
      holdUntil = performance.now() + seconds * 1000;
    },

    /** 点击：在可点击的回应里随机放一段；正在走 / 被拎着 / 蹲着时不打断。 */
    react() {
      if (performance.now() < holdUntil) return false;   // 起步原地迈步的这小段先别接点击
      if (/walk|run|drag|air|crouch/.test(modeNow)) return false;
      // ① 标了"点击"的段（清单里 reaction: true）
      let pool = reactions.filter((w) => byWord.has(w) && (!allow || allow.has(w)));
      // ② 退到约定的几段常见回应
      if (!pool.length && allow) {
        pool = [...allow].filter((w) => CLICK_FALLBACK.has(w) && byWord.has(w));
      }
      // ③ 还没有？就从已勾选的段里随便挑一段 —— 戳一下总得动一下，
      //    否则用户勾的全是"吃饭/伸懒腰"时，点她完全没反应。
      if (!pool.length && allow) {
        pool = [...allow].filter((w) => byWord.has(w));
      }
      if (!pool.length) return false;
      return play(pool[Math.floor(Math.random() * pool.length)], REACTION_MAX);
    },

    draw(petG, face, o) {
      const t = typeof o?.t === 'number' ? o.t : performance.now() / 1000;
      const mode = modeOf(o);
      modeNow = mode;

      // <image> 只建一次；被别处摘掉过（isConnected 只有浏览器里有）才重建
      if (!img || img.isConnected === false) {
        img = document.createElementNS(SVGNS, 'image');
        img.setAttribute('x', IMG_X);
        img.setAttribute('y', IMG_Y);
        img.setAttribute('width', IMG_W);
        img.setAttribute('height', IMG_H);
        img.setAttribute('preserveAspectRatio', 'none');
        img.setAttribute('class', 'action-frame');
        petG.appendChild(img);
        frame = -1;
        flipOn = null;
        shownHref = null;
      }

      const dt = last < 0 ? 0 : Math.min(t - last, 0.25);
      last = t;
      clock += dt;
      const now = t * 1000;

      const held = /carry|held|drag|air|drop|throw/.test(mode);
      const running = /run/.test(mode);
      const moving = running || /walk|move/.test(mode);
      const turning = mode === 'turn';

      // 一次性动作的计时落在本时钟上：第一帧落值，到点就放掉
      if (override && override.from < 0) override.from = now;
      if (override && now - override.from >= override.seconds * 1000) override = null;
      // 被拎起来时任何动作都让位；走路 / 转向打断的只是待机轮播出来的小动作，
      // bot 点名的动作（kind: word）继续播完
      if (override && held) override = null;
      else if (override && override.kind === 'auto' && (moving || turning)) override = null;

      if (varietyAt < 0) varietyAt = now + VARIETY_FIRST_MS;
      if (!held && !moving && !turning && !override && variety.length && now >= varietyAt) {
        const v = variety[varietyIdx++ % variety.length];
        override = { clip: v.clip, seconds: v.seconds, from: now, kind: 'auto' };
        varietyAt = now + v.seconds * 1000 + VARIETY_GAP_MS;
      }

      const wanted = override ? override.clip
        : held ? dragClip
        : running ? runClip
        : moving ? walkClip
        : turning ? turnClip
        : idleClip;

      if (wanted !== clip) {
        clip = wanted;
        frame = -1;
        clock = 0;
        animUrlNow = null;
        probeAnim(clip);          // 单文件动画模块先探一下
        releaseClip(clip);        // 只留当前片段的 blob
        prefetch(clip, 0, PREFETCH);
      }

      // 画面带字的那几段不能镜像，其它一律翻一次（素材朝左，对上 kit 的朝向约定）
      const textClip = byClip.get(clip)?.noMirror === true;
      const facing = Number(o?.facing);
      const flipWanted = textClip ? facing < 0 : true;
      if (flipWanted !== flipOn) {
        flipOn = flipWanted;
        img.setAttribute('transform', flipOn ? 'translate(256 0) scale(-1 1)' : '');
      }

      // 单文件动画：挂一次 anim.webp，让浏览器自己循环播；不再逐帧推进
      if (animState.get(clip) === 'yes') {
        const au = animUrlOf(clip);
        if (animUrlNow !== au) {
          animUrlNow = au;
          shownHref = au;
          img.setAttribute('href', au);
          img.setAttribute('xlink:href', au);
        }
        return;
      }
      // 探测还没回来：保持上一帧，别请求不存在的 f_XXXX.webp（会闪白）
      if (animState.get(clip) === 'pending') return;
      animUrlNow = null;

      const total = framesOf(clip);
      // 帧率上限：平时 24，被拎起来/悬空时 60。片段自己的 fps 不超过这个上限就按它放 ——
      // 所以 60 fps 的拖拽素材走满 60，而只有 24 fps 素材的包也不会被强行加速。
      const cap = held ? DRAG_FPS : PLAY_FPS;
      const fps = Math.min(number(byClip.get(clip)?.fps, cap), cap);
      const i = Math.floor(clock * fps + 1e-6) % total;

      if (i !== frame) {
        frame = i;
        const key = keyOf(clip, i);
        const href = urls.get(key) ?? urlOf(clip, i);   // blob 还没到时先用真地址顶上
        if (href !== shownHref) {
          shownHref = href;
          img.setAttribute('href', href);
        }
        prefetch(clip, i + 1, PREFETCH);
      }
    },
  };
}

/** 数字校验：不是有限的非负数就用兜底值。 */
function number(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}
