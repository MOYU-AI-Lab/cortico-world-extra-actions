# 0.3.36 合并说明

0.3.35 的分支基线早于 0.3.34 的双档改动，导致这些被回退：

- `src/online.js` 退回旧的 8 卷 `LIB_PARTS`（sha256 与线上文件不一致 → 下载必失败）
- `src/world.js` 没有 `downloadLibrary(tier)` / `downloadInfo().tiers`
- `dist/webui.js` 没有档位单选、保存后不显示 `r.hint`、「装扮页重新点一下」旧文案回来了

0.3.36 以 0.3.35 为底（保留 A/B/C/D 全部改动），把上面四处补回：

| 文件 | 改动 |
|---|---|
| src/online.js | `LIB_PARTS_LITE`(8) / `LIB_PARTS_FULL`(16，9–16 在 `shenshen-actions-full`) / `TIER_INFO` / `partsFor()` / `DEFAULT_TIER='lite'`；分片超时 10 分钟 |
| src/world.js | `downloadLibrary(tier)`、`downloadInfo().tiers`、按档传 `parts`、`RELOAD_HINT` 文案 |
| dist/webui.js | 档位单选（约 370 MB 有损 / 约 1.19 GB 无损）+ 单个「下载并安装」；引导与缺段提示各两个按钮；保存后显示 `r.hint`；三处旧文案改写 |
| package.json | 0.3.36 |

验证：`node --check` 全过；23 个 `test_*.mjs` 全绿。
