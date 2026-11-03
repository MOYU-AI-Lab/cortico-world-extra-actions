#!/usr/bin/env node
/**
 * 把「额外动作拓展」装进本机 Coopanion，并（可选）把动作库放进 figures。
 *
 *   node tools/install-extension.mjs --extensions <DIR> [--library <动作库目录>] [--no-copy-library]
 *
 * --extensions 必填：Coo 的 <安装目录>\data\extensions，也可以用 COOPANION_EXTENSIONS
 * --library    可选：给了才把那个动作库拷成 figures\shenshen-actions，也可以用 SHENSHEN_LIBRARY
 *
 * 做的事：
 *   1. 拷本包到 <extensions>/vendor/cortico-world-extra-actions（不含 node_modules）
 *   2. 备份 <extensions>/package.json → package.json.bak-extra-actions，加一条 link: 依赖
 *   3. 建 <extensions>/node_modules/cortico-world-extra-actions → vendor 的 junction
 * 装完要重启 Coopanion。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');   // 扩展根目录
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const NAME = 'cortico-world-extra-actions';
const extensions = resolve(opt('extensions', process.env.COOPANION_EXTENSIONS || ''));
// 动作库是可选的：不传 --library 就只装插件，不碰 figures
const library = opt('library', process.env.SHENSHEN_LIBRARY || '');
const copyLibrary = !!library && !argv.includes('--no-copy-library');
if (!opt('extensions') && !process.env.COOPANION_EXTENSIONS) {
  console.error('需要 --extensions <Coopanion/data/extensions>（或环境变量 COOPANION_EXTENSIONS）');
  process.exit(2);
}

const say = (s) => console.log(s);

if (!existsSync(join(extensions, 'node_modules'))) {
  throw new Error(`这不是 Coopanion 的 extensions 目录（缺 node_modules）：${extensions}`);
}

/* 1. 拷包 */
const vendor = join(extensions, 'vendor', NAME);
mkdirSync(join(extensions, 'vendor'), { recursive: true });
if (existsSync(vendor)) rmSync(vendor, { recursive: true, force: true });
cpSync(here, vendor, {
  recursive: true,
  filter: (p) => !p.includes('node_modules') && !p.endsWith('.git') && !p.includes('_tmp'),
});
say(`1/3 已拷贝 → ${vendor}`);

/* 2. package.json 依赖 */
const pkgFile = join(extensions, 'package.json');
const bak = `${pkgFile}.bak-extra-actions`;
const raw = readFileSync(pkgFile, 'utf8');
if (!existsSync(bak)) writeFileSync(bak, raw, 'utf8');
const pkg = JSON.parse(raw.replace(/^\uFEFF/, ''));
pkg.dependencies = pkg.dependencies || {};
pkg.dependencies[NAME] = `link:vendor/${NAME}`;
writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
say(`2/3 已登记依赖（备份 ${bak}）`);

/* 3. junction */
const link = join(extensions, 'node_modules', NAME);
if (!existsSync(link)) {
  symlinkSync(vendor, link, 'junction');
  say(`3/3 已建联接 → ${link}`);
} else {
  say(`3/3 联接已存在：${link}`);
}

/* 可选：动作库进 figures（1.4 GB，默认不拷，加 --copy-library 才拷） */
if (argv.includes('--copy-library')) {
  const figures = join(extensions, '..', 'home', 'companion', 'data', 'figures');
  const target = join(figures, 'shenshen-actions');
  if (!existsSync(join(library, 'figure.json'))) {
    say(`跳过动作库：${library} 不是动作库目录`);
  } else if (existsSync(join(target, 'figure.json'))) {
    say(`动作库已装：${target}`);
  } else {
    say(`正在拷动作库 → ${target}（1.4 GB，要几分钟）…`);
    mkdirSync(figures, { recursive: true });
    cpSync(library, target, { recursive: true, filter: (p) => !p.includes('node_modules') && !p.endsWith('.git') });
    say('动作库拷完');
  }
} else {
  const target = join(extensions, '..', 'home', 'companion', 'data', 'figures', 'shenshen-actions');
  say(existsSync(join(target, 'figure.json'))
    ? `动作库已装：${target}`
    : `动作库没装：${target}（把「${library}」整个拷过去，或加 --copy-library 让本脚本拷）`);
}

say('\n完成。重启 Coopanion → 扩展页里找「额外动作拓展」。');
