/**
 * 「额外动作拓展」—— Coopanion 扩展入口。
 *
 * 勾选动作库里的动作 → 写进形象包的 `额外动作拓展/` 文件夹 → 桌宠照着做。
 *
 * 契约（Cortico world api 6，见 frameworks 的 extensions/manifest.ts 与 world.ts）：
 *   - package.json 的 `cortico.kind` 是 world、`api` 正好是 6、`webUiClient` 是包内相对 .js；
 *   - 默认导出要有 id / label / defaults() / create()；
 *   - create(ctx) 拿到的 WorldContext 提供 cfg / dataDir / botDir / persist()；
 *   - 实例实现 start(host) / stop() / envPromptVars() / tools()，webUi() 可选。
 * 这里不引入 `cortico/*`，所以不依赖宿主的 tsx 解析链，纯 ESM 就能加载。
 */
import { ExtraActionsWorld } from './world.js';

export const EXTRA_ACTIONS = {
  id: 'extra-actions',
  label: '深深与额外动作拓展 · Shenshen & Extra Actions',
  defaults: () => ({ enabled: true, libraryDir: '', figuresDir: '' }),
  create: (ctx) => new ExtraActionsWorld({ ctx }),
  /** 不向 bot 暴露工具：这个 World 只做面板里的人肉勾选，没有模型可调用的入口。 */
  describe: { tools: [], events: [] },
};

export default EXTRA_ACTIONS;
