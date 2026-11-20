/**
 * 0.3.35 的回归测试：把 issue #6 的候选补丁逐条落成断言。
 *
 * 覆盖：
 *   ① 单动作下载先暂存再替换（坏 ZIP 不再先删旧模块）
 *   ② 预览缓存键带路径与文件状态（两个库同 id 同大小不串图）
 *   ③ 用户改过的词条在保存/清空后仍在（含老账本推断）
 *   ④ doctor：路径含 `#` 能读 index.js；表情不被误判成"缺失动作"
 *   ⑤ 新动作名字撞名自动避开（宿主 readVocab 一票否决）
 *   ⑥ 动作 id 撞上别人的别名 → 写盘前就报错，磁盘一个字没动
 *   ⑦ ensureVocabNames：名字等于自己的 id 也算重名，要改掉；改完同步 .managed.json
 *
 *   node tools/test_035_patches.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const base = join(here, '..');
const { installAction } = await import(pathToFileURL(join(base, 'src', 'online.js')));
const { ExtraActionsWorld } = await import(pathToFileURL(join(base, 'src', 'world.js')));
const { save, clear, uniqueName } = await import(pathToFileURL(join(base, 'src', 'writer.js')));
const { ensureVocabNames } = await import(pathToFileURL(join(base, 'src', 'starter.js')));

const root = join(tmpdir(), `extra-actions-035-${process.pid}`);
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const fails = [];
const check = async (name, fn) => {
  try { await fn(); console.log('ok   ' + name); }
  catch (err) { fails.push(`${name} → ${err.message}`); console.log('FAIL ' + name); }
};
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2));
const writeModule = (lib, cat, id) => {
  const d = join(lib, 'actions', cat, id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'action.json'), '{}');
  writeFileSync(join(d, 'anim.webp'), 'x');
};
const action = (id, zh, extra = {}) => ({
  id, category: 'core', word: id, zh, clip: `actions/core/${id}`, frames: 1, seconds: 1, anim: true, ...extra,
});
/** 造一个能写的最小形象包（figure.js 里要有「额外动作拓展」，不然 writer 不认）。 */
const makePack = (name, vocab = []) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'figure.json'), {
    manifest: 2, api: 2, id: 'shenshen-actions', version: '1.0.0',
    entry: 'figure.js', export: 'createActionBody', vocab,
  });
  writeFileSync(join(dir, 'figure.js'), "const X = '额外动作拓展';", 'utf8');
  return dir;
};
/** 照宿主 packs.ts → readVocab 的规则判一遍；返回 null 表示整份 vocab 会被接受。 */
function hostVocabError(vocab) {
  const NAME_BREAK = /[,，、\s【】<>＜＞]/;
  const taken = new Set();
  for (const w of vocab) {
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(String(w?.id))) return `id 不合法: ${w?.id}`;
    if (w.kind !== 'expression' && w.kind !== 'motion') return `kind 不认识: ${w.kind}`;
    for (const list of Object.values(w.names ?? {})) {
      for (const n of Array.isArray(list) ? list : []) {
        if (typeof n !== 'string' || !n.trim() || n.length > 32 || NAME_BREAK.test(n)) return `名字不合法: ${w.id} → ${JSON.stringify(n)}`;
      }
    }
    for (const n of [w.id, ...Object.values(w.names ?? {}).flat()]) {
      if (taken.has(n)) return `名字重复: ${n}`;
      taken.add(n);
    }
    const hasAbout = w.about && typeof w.about === 'object' && Object.values(w.about).some((v) => typeof v === 'string' && v.trim());
    if (!hasAbout) return `缺 about: ${w.id}`;
    if (typeof w.seconds !== 'number' || !(w.seconds > 0)) return `seconds 不合法: ${w.id}`;
  }
  return null;
}
/** 造一个最小 ZIP（和项目现有在线测试一致：只有测试数据）。 */
function zip(entries) {
  const chunks = [], central = [];
  let off = 0;
  for (const [name, data] of entries) {
    const raw = Buffer.from(data), compressed = deflateRawSync(raw), n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    chunks.push(local, n, compressed);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(compressed.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(off, 42);
    central.push(cd, n);
    off += local.length + n.length + compressed.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...chunks, index, end]);
}

try {
  /* ① 坏 ZIP 不能把已经装好的那段弄丢 */
  await check('① 下载坏的/不完整的 ZIP 时，旧模块原样保留', async () => {
    const lib = join(root, 'download-lib');
    const target = join(lib, 'actions', 'core', 'cheer-hop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'anim.webp'), 'old animation');
    writeFileSync(join(target, 'action.json'), '{"old":true}');
    const payloads = {
      '/bad.zip': Buffer.from('not a valid zip'),
      '/bad-json.zip': zip([['action.json', '{'], ['anim.webp', 'x']]),
      '/wrong-id.zip': zip([['action.json', '{"id":"other"}'], ['anim.webp', 'x']]),
      '/no-animation.zip': zip([['action.json', '{"id":"cheer-hop"}']]),
      '/valid.zip': zip([['action.json', '{"id":"cheer-hop","category":"core"}'], ['anim.webp', 'new animation']]),
    };
    const server = createServer((req, res) => res.end(payloads[req.url] ?? ''));
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    try {
      const port = server.address().port;
      for (const path of ['/bad.zip', '/bad-json.zip', '/wrong-id.zip', '/no-animation.zip']) {
        await assert.rejects(() => installAction({ url: `http://127.0.0.1:${port}${path}`, libraryDir: lib, category: 'core', id: 'cheer-hop' }), `应当拒绝 ${path}`);
        assert.equal(readFileSync(join(target, 'anim.webp'), 'utf8'), 'old animation', `${path} 把旧动画删了`);
        assert.equal(readFileSync(join(target, 'action.json'), 'utf8'), '{"old":true}', `${path} 把旧 action.json 删了`);
      }
      // 临时目录也没留下来
      const leftover = readdirSync(join(lib, 'actions', 'core'));
      assert.equal(leftover.length, 1, `action 目录下应该只剩 cheer-hop，实际 ${leftover.join('、')}`);
      await installAction({ url: `http://127.0.0.1:${port}/valid.zip`, libraryDir: lib, category: 'core', id: 'cheer-hop' });
      assert.equal(readFileSync(join(target, 'anim.webp'), 'utf8'), 'new animation', '好 ZIP 应当装上去');
    } finally {
      await new Promise((res) => server.close(res));
    }
  });

  /* ② 两个库同 id 同大小，预览不能串 */
  await check('② 不同动作库里同 id 同大小的文件不共用预览缓存', async () => {
    const mk = (name, content) => {
      const lib = join(root, name);
      const dir = join(lib, 'actions', 'core', 'cheer-hop');
      mkdirSync(dir, { recursive: true });
      writeJson(join(dir, 'action.json'), { id: 'cheer-hop', category: 'core', word: 'cheer-hop', zh: 'x', clip: 'actions/core/cheer-hop', frames: 1, seconds: 1, anim: true });
      writeFileSync(join(dir, 'anim.webp'), content);
      const cfg = { libraryDir: lib };
      const dataDir = join(root, 'data-' + name);
      mkdirSync(dataDir, { recursive: true });
      return new ExtraActionsWorld({ ctx: { dataDir, cfg, botDir: join(root, 'bot'), persist: (p) => Object.assign(cfg, p), packageDir: base, repoRoot: base } });
    };
    const a = await mk('library-a', 'aaaaaaaa').invoke('picker', 'preview', ['cheer-hop']);
    const b = await mk('library-b', 'bbbbbbbb').invoke('picker', 'preview', ['cheer-hop']);
    assert.notEqual(a.dataUrl, b.dataUrl, '两张图不该一样');
    assert.equal(Buffer.from(b.dataUrl.split(',')[1], 'base64').toString(), 'bbbbbbbb', 'B 库应当显示 B 的图');
  });

  /* ③ 用户改过的词条要保住 */
  await check('③ 用户改过的词条内容，保存和清空之后都还在', async () => {
    const lib = join(root, 'vocab-lib');
    writeModule(lib, 'core', 'cheer-hop');
    writeModule(lib, 'core', 'cheer-wave');
    const pack = makePack('vocab-pack', [{ id: 'happy', kind: 'expression', names: { zh: ['原名'] }, about: { zh: '表情' }, seconds: 1 }]);
    const a = action('cheer-hop', '跳跃'), b = action('cheer-wave', '挥手');
    const args = { packDir: pack, catalog: [a, b], libraryDir: lib, pack: { id: 'shenshen-actions' } };
    save({ ...args, ids: [a.id] });
    const fig = JSON.parse(readFileSync(join(pack, 'figure.json'), 'utf8'));
    fig.vocab.find((x) => x.id === 'happy').names.zh = ['用户修改'];
    writeJson(join(pack, 'figure.json'), fig);
    save({ ...args, ids: [a.id, b.id] });
    let after = JSON.parse(readFileSync(join(pack, 'figure.json'), 'utf8'));
    assert.deepEqual(after.vocab.find((x) => x.id === 'happy').names.zh, ['用户修改'], '保存后被旧快照覆盖了');
    clear(pack, [a, b], 'shenshen-actions');
    after = JSON.parse(readFileSync(join(pack, 'figure.json'), 'utf8'));
    assert.deepEqual(after.vocab.find((x) => x.id === 'happy').names.zh, ['用户修改'], '清空后用户的修改丢了');
  });

  await check('③b 改完立刻清空，也不会被旧快照覆盖', async () => {
    const lib = join(root, 'immediate-lib');
    writeModule(lib, 'core', 'cheer-hop');
    const pack = makePack('immediate-pack', [{ id: 'happy', kind: 'expression', names: { zh: ['原名'] }, about: { zh: '表情' }, seconds: 1 }]);
    const a = action('cheer-hop', '跳跃');
    save({ packDir: pack, ids: [a.id], catalog: [a], libraryDir: lib, pack: { id: 'shenshen-actions' } });
    const fig = JSON.parse(readFileSync(join(pack, 'figure.json'), 'utf8'));
    fig.vocab.find((x) => x.id === 'happy').names.zh = ['直接清空前修改'];
    writeJson(join(pack, 'figure.json'), fig);
    clear(pack, [a]);
    const final = JSON.parse(readFileSync(join(pack, 'figure.json'), 'utf8'));
    assert.deepEqual(final.vocab.map((x) => x.id), ['happy']);
    assert.deepEqual(final.vocab[0].names.zh, ['直接清空前修改']);
  });

  await check('③c 老账本（没有 writtenVocab）里改过的扩展词也保住', async () => {
    const lib = join(root, 'legacy-lib');
    writeModule(lib, 'core', 'cheer-hop');
    const pack = makePack('legacy-pack', []);
    const a = action('cheer-hop', '跳跃');
    save({ packDir: pack, ids: [a.id], catalog: [a], libraryDir: lib, pack: { id: 'shenshen-actions' } });
    const managedPath = join(pack, '额外动作拓展', '.managed.json');
    const managed = JSON.parse(readFileSync(managedPath, 'utf8'));
    delete managed.writtenVocab;
    writeJson(managedPath, managed);
    const fig = JSON.parse(readFileSync(join(pack, 'figure.json'), 'utf8'));
    fig.vocab[0].names.zh = ['旧账本中的用户修改'];
    writeJson(join(pack, 'figure.json'), fig);
    clear(pack, [a]);
    const final = JSON.parse(readFileSync(join(pack, 'figure.json'), 'utf8'));
    assert.deepEqual(final.vocab[0].names.zh, ['旧账本中的用户修改']);
  });

  /* ④ doctor */
  await check('④ 路径含 # 也能读出 index.js，且表情不算缺失动作', async () => {
    const lib = join(root, 'doctor-lib');
    writeModule(lib, 'core', 'cheer-hop');
    const pack = makePack('电脑 #1 形象包', [{ id: 'happy', kind: 'expression', names: { zh: ['开心'] }, about: { zh: '表情' }, seconds: 1 }]);
    const a = action('cheer-hop', '跳跃');
    save({ packDir: pack, ids: [a.id], catalog: [a], libraryDir: lib, pack: { id: 'shenshen-actions' } });

    // 直接在进程内跑 doctor.mjs（沙箱里 spawn 捕获输出会 EPERM）
    const logs = [];
    const realLog = console.log, realErr = console.error, realExit = process.exit, realArgv = process.argv[2];
    let code = 0;
    console.log = (...x) => logs.push(x.join(' '));
    console.error = (...x) => logs.push(x.join(' '));
    process.exit = (c = 0) => { code = c; throw new Error('__doctor_exit__'); };
    process.argv[2] = pack;
    try {
      await import(pathToFileURL(join(base, 'tools', 'doctor.mjs')).href + '?v=' + Math.random());
    } catch (e) {
      if (e.message !== '__doctor_exit__') throw e;
    } finally {
      console.log = realLog; console.error = realErr; process.exit = realExit; process.argv[2] = realArgv;
    }
    const out = logs.join('\n');
    assert.equal(code, 0, 'doctor 应当判为没问题：\n' + out);
    assert.match(out, /没发现问题/, out);
    assert.match(out, /index 条目：1 条/, 'index.js 没读出来（# 路径仍然被截断？）\n' + out);
  });

  /* ⑤ 撞名自动避开 */
  await check('⑤ 新动作的名字和已有词条撞名时自动避开（不让宿主拒掉整份词表）', async () => {
    const lib = join(root, 'names-lib');
    writeModule(lib, 'core', 'cheer-hop');
    writeModule(lib, 'core', 'cheer-wave');
    const pack = makePack('names-pack', [{ id: 'happy', kind: 'expression', names: { zh: ['跳跃'] }, about: { zh: '表情' }, seconds: 1 }]);
    const actions = [action('cheer-hop', '跳跃'), action('cheer-wave', '跳跃')];
    save({ packDir: pack, ids: actions.map((x) => x.id), catalog: actions, libraryDir: lib, pack: { id: 'shenshen-actions' } });
    const fig = JSON.parse(readFileSync(join(pack, 'figure.json'), 'utf8'));
    assert.equal(hostVocabError(fig.vocab), null, '宿主会拒掉整份 vocab：' + hostVocabError(fig.vocab));
    assert.deepEqual(fig.vocab.find((x) => x.id === 'happy').names.zh, ['跳跃'], '已有词条被改了');
    const names = fig.vocab.filter((x) => x.id !== 'happy').map((x) => x.names.zh[0]);
    assert.equal(new Set(names).size, 2, '两个新动作的名字还是一样的：' + names.join('、'));
  });

  await check('⑤b uniqueName 撞名加序号、且始终不超过 32 字', async () => {
    const taken = new Set(['跳跃', '跳跃2']);
    assert.equal(uniqueName('跳跃', taken), '跳跃3');
    assert.equal(uniqueName('别的', taken), '别的');
    const long = '很'.repeat(32);
    const t2 = new Set([long]);
    const got = uniqueName(long, t2);
    assert.equal(got.length, 32, '加序号之后超了 32 字');
    assert.notEqual(got, long);
  });

  /* ⑥ 别名冲突：写盘前报错，磁盘不动 */
  await check('⑥ 动作 id 撞上已有词条的别名时报错，且磁盘一个字没动', async () => {
    const lib = join(root, 'alias-lib');
    writeModule(lib, 'core', 'cheer-hop');
    const pack = makePack('alias-pack', [{ id: 'happy', kind: 'expression', names: { zh: ['cheer-hop'] }, about: { zh: '表情' }, seconds: 1 }]);
    const before = readFileSync(join(pack, 'figure.json'), 'utf8');
    const a = action('cheer-hop', '跳跃');
    assert.throws(() => save({ packDir: pack, ids: [a.id], catalog: [a], libraryDir: lib, pack: { id: 'shenshen-actions' } }), /冲突/);
    assert.equal(readFileSync(join(pack, 'figure.json'), 'utf8'), before, 'figure.json 被改了');
    assert.equal(existsSync(join(pack, '额外动作拓展')), false, '不该建出 额外动作拓展 目录');
  });

  /* ⑦ ensureVocabNames */
  await check('⑦ ensureVocabNames：名字等于自己的 id 也算重名，会改掉并同步账本', async () => {
    const lib = join(root, 'ensure-lib');
    writeModule(lib, 'core', 'cheer-hop');
    const pack = makePack('ensure-pack', []);
    const a = action('cheer-hop', '跳跃');
    save({ packDir: pack, ids: [a.id], catalog: [a], libraryDir: lib, pack: { id: 'shenshen-actions' } });
    // 人为弄坏：把名字改成自己的 id，再塞一条带全角逗号的名字
    const fig = JSON.parse(readFileSync(join(pack, 'figure.json'), 'utf8'));
    fig.vocab[0].names.zh = ['cheer-hop'];
    fig.vocab.push({ id: 'what-to-eat', kind: 'motion', names: { zh: ['是啊，吃什么'] }, about: { zh: '碎碎念' }, seconds: 10 });
    writeJson(join(pack, 'figure.json'), fig);
    assert.notEqual(hostVocabError(fig.vocab), null, '夹具本身应当是不合规的');

    const r = ensureVocabNames(pack);
    assert.equal(r.changed, true, '没有修');
    const fixed = JSON.parse(readFileSync(join(pack, 'figure.json'), 'utf8'));
    assert.equal(hostVocabError(fixed.vocab), null, '修完还是不合规：' + hostVocabError(fixed.vocab));

    // 账本同步：writtenVocab 必须等于刚写下去的那份，否则下次会被当成用户编辑
    const managed = JSON.parse(readFileSync(join(pack, '额外动作拓展', '.managed.json'), 'utf8'));
    assert.deepEqual(managed.writtenVocab, fixed.vocab, '.managed.json 的 writtenVocab 没同步');

    // 幂等
    assert.equal(ensureVocabNames(pack).changed, false, '第二次又写了');
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(fails.length ? `\nFAIL (${fails.length})\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exitCode = fails.length ? 1 : 0;
