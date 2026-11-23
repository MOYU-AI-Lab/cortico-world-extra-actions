# 0.3.37 合并说明

用户的 0.3.36 构建带了「动作库 ▾ → 更新走/跑动画…」修复按钮，但基线仍早于 0.3.34：
双档动作库整块缺失（`LIB_PARTS` 退回旧 8 卷、sha256 与线上不一致、面板无档位单选）。
0.3.37 = 该构建为底 + 补回双档。

| 文件 | 改动 |
|---|---|
| src/online.js | 补回 `LIB_PARTS_LITE`(8) / `LIB_PARTS_FULL`(16，9–16 在 `shenshen-actions-full`) / `TIER_INFO` / `partsFor()` / `DEFAULT_TIER`；**保留** `FIX_FILES` / `downloadFix`（fix tag）；分片超时 10 分钟 |
| src/world.js | import 补 `TIER_INFO`/`partsFor`/`DEFAULT_TIER`；`downloadLibrary(tier)`、`downloadInfo().tiers`、按档传 `parts`、`RELOAD_HINT` 文案 |
| dist/webui.js | 档位单选（约 370 MB 有损 / 约 1.19 GB 无损）+ 单个「下载并安装」；引导与缺段提示各两个按钮；保存后显示 `r.hint`；三处旧文案改写；**保留**修复按钮 |
| package.json | 0.3.37 |

## 验证

- `node --check`：src/*.js、dist/webui.js 全部通过
- 测试：23/24 通过；唯一失败的 `test_refresh.mjs` 在原始 0.3.36 上同样失败，原因是硬编码了作者机器的 `E:\DSH-PET\形象包\深深-动作库-高清` 路径（环境依赖，不是回归）

## 修复包（已上线 Gitee）

tag `fix`，4 个文件（walk-fix / crab-fix × lossy / lossless），线上回拉 sha256 全部一致；
动作库 8 个分片未改动。
