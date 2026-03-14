# UI: Agents 面板 - 心跳间隔配置 + 状态显示

> GitHub Issue: https://github.com/lanzhizhuxia/openclaw/issues/4
> 拆分自 #1，对应原 issue「改造内容 §2」
> 依赖: #3（共享 Agents 面板 UI 结构和 collapsible 组件）

## Summary

心跳功能目前的间隔时间（默认 30 分钟）只能通过 JSON 配置修改，且 UI 上没有任何心跳调度状态的可见性。用户无从得知心跳何时会运行、上次运行结果如何，容易造成不知情的 token 消耗。

本 issue 聚焦于：在 Agents 面板中增加心跳间隔的 UI 配置，并展示心跳调度状态。

## Fork 影响评估

> 参见 [Fork 维护策略](../FORK_PRINCIPLES.md)

### 需修改的上游文件

| 文件                            | 改动类型                                | Merge 风险 |
| ------------------------------- | --------------------------------------- | ---------- |
| `ui/src/ui/views/agents.ts`     | 中间插入（心跳区域加间隔控件+状态展示） | **高**     |
| `src/infra/heartbeat-runner.ts` | 可能需新增状态暴露方法 + 结果追踪字段   | **中**     |
| `ui/src/i18n/locales/en.ts`     | 追加 i18n 字符串                        | **低**     |

### Fork-only 文件（零冲突）

| 文件                                             | 说明                     |
| ------------------------------------------------ | ------------------------ |
| `src/gateway/server-methods/heartbeat-status.ts` | 新建 RPC handler（推荐） |
| UI 组件文件（如适用）                            | 心跳状态展示组件可独立   |

### 结论

**比 #3 风险更高** — 不仅改 UI，还要改 Gateway 后端。RPC handler 新建文件风险低，但 `heartbeat-runner.ts` 的改动（新增结果追踪）风险中等。

建议：

- RPC handler 用新建文件（`src/gateway/server-methods/heartbeat-status.ts`）
- `heartbeat-runner.ts` 改动尽量小，只暴露已有的 `lastRunMs`/`nextDueMs`，结果追踪留后续 issue
- UI 部分与 #3 共享 collapsible 结构

## 代码探索发现（2026-03-14）

### HeartbeatRunner 内部状态

**文件**: `src/infra/heartbeat-runner.ts`

```typescript
interface HeartbeatAgentState {
  agentId: string;
  heartbeat?: HeartbeatConfig; // from AgentDefaultsConfig["heartbeat"]
  intervalMs: number;
  lastRunMs?: number; // 上次运行时间戳
  nextDueMs: number; // 下次到期时间戳
}
```

- 维护 `Map<string, HeartbeatAgentState>` — 每个 agent 独立调度
- `resolveNextDue(lastRunMs, intervalMs)` 计算下次到期
- `advanceAgentSchedule()` 在运行后更新 `lastRunMs` 和 `nextDueMs`
- `scheduleNext()` 管理 `setTimeout` 调度

**⚠️ 关键发现**：当前 **不追踪运行结果**（成功/失败/已通知），只有 `lastRunMs` 时间戳。Issue 假设的 `ok | notified | failed | never` 状态枚举在现有代码中**不存在**。

### HeartbeatConfig 结构

**文件**: `src/auto-reply/heartbeat.ts`

```typescript
DEFAULT_HEARTBEAT_EVERY = "30m"
DEFAULT_HEARTBEAT_ACK_MAX_CHARS = ...
```

HeartbeatConfig 包含:

- `every`: 间隔字符串（如 "30m"）
- `prompt`: 心跳 prompt
- `target`: 通知目标
- `model`: 使用的模型
- `ackMaxChars`: 最大确认字符数

`resolveHeartbeatIntervalMs()` 负责解析 `every` 字符串为毫秒。

### 现有 RPC 状况

- **没有**暴露心跳调度状态的 RPC 方法
- 现有 RPC 集中在 sessions、agent、auth、chat、cron、tools 等领域
- Cron 相关 RPC 有先例（`server.cron.test.ts`），但不包含心跳信息
- **需要新建 RPC** 确认

### 现有心跳 UI

- **没有**任何现有的心跳状态 UI 组件
- i18n 中可能有 heartbeat 相关字符串但无 UI 渲染代码

## 改造内容

### 心跳间隔输入框

- 在 Agents 面板的心跳区域增加间隔时间控件
- 修改 `agents.defaults.heartbeat.every`
- 支持常见预设（30m、1h、4h、12h）及自定义输入
- 无效输入不得静默写入配置

### 心跳状态展示

- **下次触发时间**：实时显示预计下次心跳运行时间
- **上次运行时间**：显示上次执行时间

> ⚠️ **注意**：原 issue 要求展示「上次运行状态（OK / 已通知 / 失败 / 从未运行）」，但 `HeartbeatRunner` 当前不追踪运行结果。有两种处理方式：
>
> 1. **MVP**: 只展示 `lastRunMs` 和 `nextDueMs`（无需改后端核心逻辑）
> 2. **完整版**: 在 `HeartbeatAgentState` 中新增 `lastResult` 字段（需改 `heartbeat-runner.ts`，merge 风险增加）
>
> **建议先做 MVP，结果追踪留后续 issue。**

## 需实现前明确的规格

1. **RPC 接口契约**：新建 RPC 方法，建议签名：
   ```typescript
   // Request
   { method: "heartbeat.status", params: { agentId?: string } }
   // Response
   {
     agents: Array<{
       agentId: string
       every: string          // 配置的间隔字符串
       intervalMs: number     // 解析后的毫秒数
       lastRunMs?: number     // 上次运行时间戳（无则 undefined）
       nextDueMs: number      // 下次到期时间戳
       enabled: boolean       // 心跳是否启用
     }>
   }
   ```
2. **MVP vs 完整版**：是否先跳过运行结果追踪（`lastResult` 字段）？建议 MVP 先行
3. **时间戳显示**：建议用相对时间（"3 分钟后"、"12 分钟前"），可切换绝对时间
4. **轮询策略**：建议 30s 轮询（心跳间隔最短通常 ≥ 5m，30s 更新足够）
5. **输入 grammar**：`heartbeat.every` 已有 `resolveHeartbeatIntervalMs()` 解析器，需确认其支持的格式（`30m`? `1h30m`? `90`?），并在 UI 端做前置校验
6. **多 agent 展示**：展示当前选中 agent 的心跳状态，还是所有 agent 汇总？建议跟随 Agents 面板的 agent 选择器
7. **心跳 disabled 的 agent**：显示 "心跳未启用" 而非空状态
8. **测试覆盖**：新 RPC 需要 contract test；UI 端至少需要状态渲染的 snapshot test

## 估算工作量

| 范围                                         | 工作量 |
| -------------------------------------------- | ------ |
| **MVP**（间隔配置 + 时间展示，不含结果追踪） | 2d     |
| **完整版**（含运行结果追踪）                 | 3-4d   |

建议选 MVP，后续根据需要加结果追踪。

## 实现检查清单

- [ ] 新建 `src/gateway/server-methods/heartbeat-status.ts`（RPC handler）
- [ ] 注册 RPC 方法（需改上游文件，标记 `// fork: heartbeat-status-rpc`）
- [ ] UI: 心跳间隔输入控件（预设 + 自定义）
- [ ] UI: 心跳状态展示（下次触发 + 上次运行时间）
- [ ] UI: 30s 轮询逻辑
- [ ] i18n 字符串
- [ ] RPC contract test
- [ ] 部署文档更新

## 参考

- HeartbeatRunner: `src/infra/heartbeat-runner.ts` — `HeartbeatAgentState`, `resolveNextDue`, `advanceAgentSchedule`
- Heartbeat config: `src/auto-reply/heartbeat.ts` — `DEFAULT_HEARTBEAT_EVERY`
- Interval parser: `src/infra/heartbeat-runner.ts` — `resolveHeartbeatIntervalMs()`
- Config schema: `src/config/zod-schema.agent-defaults.ts`, `src/config/types.agent-defaults.ts`
- 现有 RPC 模式: `src/gateway/server-methods/` 目录
- Fork 维护策略: `docs/fork/FORK_PRINCIPLES.md`
- 前置依赖 #3: `docs/fork/issues/003-ui-agents-per-feature-model-selectors.md`
