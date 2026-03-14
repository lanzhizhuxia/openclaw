# UI: Agents 面板 - 按功能绑定模型的专用选择器

> GitHub Issue: https://github.com/lanzhizhuxia/openclaw/issues/3
> 拆分自 #1，对应原 issue「改造内容 §1」

## Summary

Control UI 的 Agents 面板目前只暴露了主模型下拉框和 fallbacks 输入框。心跳、压缩/摘要、子代理、图片理解这四个支持独立模型配置的功能，只能通过通用配置表单编辑器修改，难以发现和使用。

本 issue 聚焦于纯 UI 增强：在 Agents 面板中为上述功能增加专用模型选择器。

## Fork 影响评估

> 参见 [Fork 维护策略](../FORK_PRINCIPLES.md)

### 需修改的上游文件

| 文件                              | 改动类型                               | Merge 风险 |
| --------------------------------- | -------------------------------------- | ---------- |
| `ui/src/ui/views/agents.ts`       | 中间插入（主模型选择器下方加新 UI 块） | **中-高**  |
| `ui/src/ui/views/agents-utils.ts` | 可能需扩展 `buildModelOptions()`       | **中**     |
| `ui/src/i18n/locales/en.ts`       | 追加 i18n 字符串                       | **低**     |

### Fork-only 文件（零冲突）

| 文件                                 | 说明                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- |
| 可选：独立的 collapsible UI 组件文件 | 如抽成 `ui/src/ui/components/collapsible.ts` 可降低 agents.ts 的改动量 |

### 结论

**无法完全用 fork-only 文件实现**，必须修改上游 UI 文件。建议：

- 用 `// fork: feature-model-overrides` 注释标记所有 fork 改动区域
- 尽量把逻辑抽到可复用的新文件中，减少 `agents.ts` 的 diff 面积
- 定期 rebase 时优先关注此文件

## 代码探索发现（2026-03-14）

### 主模型选择器（现有实现）

**文件**: `ui/src/ui/views/agents.ts`

- 用 `<select>` HTML 元素实现
- `.value=${effectivePrimary ?? ""}` 绑定当前值
- `@change` → `onModelChange(agent.id, value)` 触发更新
- Options 由 `buildModelOptions(configForm, effectivePrimary)` 生成
- 非默认 agent 有 `<option value="">Inherit default (${defaultPrimary})</option>` 继承选项
- 整体保存通过 `onConfigSave` 按钮，`configDirty` 控制按钮启用

### `buildModelOptions()` 函数

**文件**: `ui/src/ui/views/agents-utils.ts`

```typescript
export function buildModelOptions(
  configForm: Record<string, unknown> | null,
  current?: string | null,
): TemplateResult;
```

- 从 `configForm` 通过 `resolveConfiguredModels()` 获取已配置模型列表
- 返回 Lit `html` 模板（一系列 `<option>` 元素）
- 如果 `current` 值不在模型列表中，会添加为特殊 "Current" 选项（处理已下架模型）

### 配置 Schema

配置键已在以下文件中定义（无需修改后端）：

- `src/config/zod-schema.agent-defaults.ts` — Zod 验证
- `src/config/types.agent-defaults.ts` — TypeScript 类型
- `src/config/schema.help.ts` — 帮助文档
- `src/config/schema.labels.ts` — 标签

### Cron 模型输入（参考）

**文件**: `ui/src/ui/views/cron.ts:1148-1175`

- 使用 `<input list="cron-model-suggestions">` + `<datalist>` 模式
- 允许自由文本输入 + 下拉建议
- 与 agents 的 `<select>` 模式不同

### Collapsible UI 组件

`agents.ts` 中**没有**现成的 collapsible/accordion 组件。需要新建或从其他地方引入。

## 改造内容

在 Agents 面板中为以下功能增加专用模型下拉框，归类到主模型选择器下方的可折叠「按功能模型覆盖」区域：

| 功能      | 配置键                             | 当前 UI        |
| --------- | ---------------------------------- | -------------- |
| 心跳      | `agents.defaults.heartbeat.model`  | 仅通用配置表单 |
| 压缩/摘要 | `agents.defaults.compaction.model` | 仅通用配置表单 |
| 子代理    | `agents.defaults.subagents.model`  | 仅通用配置表单 |
| 图片理解  | `agents.defaults.imageModel`       | 仅通用配置表单 |

每个选择器应：

- 复用 `buildModelOptions()` 辅助函数
- 使用 `<select>` 模式（与主模型选择器一致，非 `<input list>` 模式）
- 非默认 agent 支持「继承默认值」选项，显示实际继承到的模型名
- 通过标准 `config.set` RPC 流程保存
- 已保存的模型 ID 若已下架，需优雅显示「模型不可用」并保留原始配置

## 需实现前明确的规格

1. **继承优先级矩阵**：非默认 agent 未设置时，精确的 fallback 顺序是什么？（agent 显式值 → defaults 值 → 全局 model？）
2. **「继承默认值」显示**：继承时显示实际继承到的模型名（如 `Inherit default (gpt-4o)`），与主模型选择器行为一致
3. **加载/错误/空状态**：模型列表不可用时复用现有 `<select>` 的 disabled 行为（`configLoading || configSaving`）
4. **Collapsible 区域行为**：折叠状态是否持久化？建议默认折叠，不持久化（每次打开页面默认折叠）
5. **per-agent 覆盖范围**：本 issue 只做 `agents.defaults.*` 级别，还是也做 per-agent 级别的覆盖 UI？建议先只做 defaults。
6. **测试覆盖**：是否需要为 config 写入路径和继承显示逻辑补充 UI 回归测试

## 估算工作量

**Small（约 1d）** — 纯 UI 变更，可复用现有模式。如果加 per-agent 覆盖则 +0.5d。

## 实现顺序

建议 **先完成本 issue (#3) 再实现 #4**。#4 的心跳间隔 UI 会放在同一区域，共享 collapsible 组件。

## 参考

- 主模型下拉框: `ui/src/ui/views/agents.ts` (search `effectivePrimary`)
- buildModelOptions: `ui/src/ui/views/agents-utils.ts`
- Cron 模型输入: `ui/src/ui/views/cron.ts:1148-1175`
- Config schema: `src/config/zod-schema.agent-defaults.ts`, `src/config/types.agent-defaults.ts`
- Fork 维护策略: `docs/fork/FORK_PRINCIPLES.md`
