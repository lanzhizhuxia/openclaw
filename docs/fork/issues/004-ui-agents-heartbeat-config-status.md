# UI: Agents 面板 - 心跳间隔配置 + 状态显示

> GitHub Issue: https://github.com/lanzhizhuxia/openclaw/issues/4
> 拆分自 #1，对应原 issue「改造内容 §2」
> 依赖: #3（软依赖 — 共享 collapsible 组件，可并行开发，接口先对齐即可）

## Summary

心跳功能目前的间隔时间（默认 30 分钟）只能通过 JSON 配置修改，且 UI 上没有任何心跳调度状态的可见性。用户无从得知心跳何时会运行、上次运行结果如何，容易造成不知情的 token 消耗。

本 issue 聚焦于：在 Agents 面板中增加心跳间隔的 UI 配置，并展示心跳调度状态。

## 方案选择：MVP+（Oracle 审核后确定）

> 2026-03-14 Oracle 审核结论：走 **MVP+** 路线（快照 RPC + 事件增量更新），不做纯轮询，不做持久化。

| 范围               | 内容                                                 | 工作量 |
| ------------------ | ---------------------------------------------------- | ------ |
| **MVP+（选定）**   | 快照 RPC + 间隔配置 + lastRun/nextDue + 内存状态映射 | 1-2d   |
| 完整版（内存追踪） | 上述 + `lastResult` 持久化字段                       | 2-3d   |
| 完整版（持久化）   | 上述 + 重启后状态连续性                              | 3d+    |

## Fork 影响评估

> 参见 [Fork 维护策略](../FORK_PRINCIPLES.md)

### 需修改的上游文件

| 文件                            | 改动类型                         | Merge 风险           |
| ------------------------------- | -------------------------------- | -------------------- |
| `ui/src/ui/views/agents.ts`     | **最小挂载点** — 只加组件引用    | **中**（已从高降级） |
| `src/infra/heartbeat-runner.ts` | 暴露已有 `lastRunMs`/`nextDueMs` | **低-中**            |
| `ui/src/i18n/locales/en.ts`     | 追加 i18n 字符串                 | **低**               |

### Fork-only 文件（零冲突）

| 文件                                               | 说明                               |
| -------------------------------------------------- | ---------------------------------- |
| `src/gateway/server-methods/heartbeat-status.ts`   | 新建 RPC handler                   |
| `ui/src/ui/components/heartbeat-card.ts`（或类似） | **新建独立子组件**（核心降险手段） |

### 结论（Oracle 审核后更新）

**风险已显著降低** — 核心策略变更：

1. **UI 做独立子组件文件**，`agents.ts` 只保留最小挂载点（从"高风险"降为"中风险"）
2. **RPC handler 新建文件**（零冲突）
3. **`heartbeat-runner.ts` 改动极小** — 只暴露已有的内存状态，不新增字段
4. **不做结果持久化** — MVP+ 范围内无需改动 `HeartbeatAgentState` 结构

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

**⚠️ 关键发现**：当前 **不追踪运行结果**（成功/失败/已通知），只有 `lastRunMs` 时间戳。但 `emitHeartbeatEvent()` 已经发出丰富的状态事件（见下方状态映射）。

### emitHeartbeatEvent 已有事件（关键发现）

`runHeartbeatOnce()` 运行后通过 `emitHeartbeatEvent()` 发出以下 status：

- `ok-empty` — 心跳运行，无需通知
- `ok-token` — 心跳运行，模型回复 HEARTBEAT_OK
- `sent` — 心跳消息已发送给用户
- `skipped` — 跳过（原因：disabled/quiet-hours/requests-in-flight/duplicate/alerts-disabled/no-target 等）
- `failed` — 运行失败

**这些事件可直接复用为 UI 状态来源，无需在 runner 中新增字段。**

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

## 技术规格（Oracle 审核后确定）

### 1. 状态映射（必须先定义）

```
emitHeartbeatEvent status  →  UI 展示状态
─────────────────────────────────────────
ok-empty / ok-token        →  ok       （心跳正常，无需通知）
skipped                    →  ok       （跳过 = 正常行为）
sent                       →  notified （已发送通知给用户）
failed                     →  failed   （运行失败）
无运行记录                  →  never    （自本次启动以来从未运行）
```

> ⚠️ 此映射必须写进 RPC contract 注释和测试，前后端共用。

### 2. RPC 接口契约

```typescript
// Request
{ method: "heartbeat.status", params: { agentId?: string } }

// Response
{
  agents: Array<{
    agentId: string
    every: string          // 配置的间隔字符串（如 "30m"）
    intervalMs: number     // 解析后的毫秒数
    lastRunMs?: number     // 上次运行时间戳（自本次启动以来）
    nextDueMs: number      // 下次到期时间戳
    enabled: boolean       // 心跳是否启用
    lastUiStatus: "ok" | "notified" | "failed" | "never"  // 派生状态
  }>
  uptimeSinceMs: number    // Gateway 启动时间戳，用于 UI 标注"自启动以来"
}
```

### 3. 数据更新策略：快照 + 事件增量

- **首屏**：调用 `heartbeat.status` RPC 拉快照
- **后续**：订阅 `emitHeartbeatEvent()` 事件流做增量更新（如果 UI 有 WebSocket/SSE 通道）
- **降级**：若事件订阅不可用，退化到 30s 轮询

### 4. 输入 grammar

- **仅支持**：`(\d+)(s|m|h|d)` 格式
- **预设选项**：30m、1h、4h、12h
- **自定义**：允许用户输入，前端即时校验，非法输入不下发
- **与后端共用**：`resolveHeartbeatIntervalMs()` 解析逻辑

### 5. 间隔修改后立即重调度

保存 `every` 后必须立即触发 `runner.updateConfig()`，重新计算 `nextDueMs` 并返回新快照。否则 UI 显示"已保存"但实际仍按旧计划触发。

### 6. 重启后状态语义

- `HeartbeatRunner` 状态为纯内存，重启后 `lastRunMs` 回到 undefined
- UI 必须明确标注 **"自本次启动以来"** 的语义
- RPC 返回 `uptimeSinceMs` 供 UI 展示参考时间范围
- **这是 MVP+ 的已知限制，不在本期解决**

### 7. 多 agent 展示

- 跟随 Agents 面板的 agent 选择器，展示当前选中 agent 的心跳状态
- 心跳 disabled 的 agent 显示 "心跳未启用" 而非空状态
- 全局 defaults 与 per-agent 覆盖并存时，显示 **实际生效间隔**（非仅 defaults）

### 8. 时间戳显示

- 默认用相对时间（"3 分钟后"、"12 分钟前"）
- 可切换绝对时间

## 实现检查清单

- [ ] 新建 `src/gateway/server-methods/heartbeat-status.ts`（RPC handler）
- [ ] 注册 RPC 方法（需改上游文件，标记 `// fork: heartbeat-status-rpc`）
- [ ] **新建独立 UI 子组件**（如 `heartbeat-card.ts`），`agents.ts` 只加最小挂载点
- [ ] UI: 心跳间隔输入控件（预设 + 自定义，前端校验）
- [ ] UI: 心跳状态展示（nextDue + lastRun + lastUiStatus + "自启动以来"标注）
- [ ] UI: 首屏快照 + 事件增量更新（降级 30s 轮询）
- [ ] 间隔修改后立即重调度 + 返回新快照
- [ ] 状态映射写进 RPC contract 注释
- [ ] i18n 字符串
- [ ] RPC contract test（字段/状态映射/重调度后 nextDue 变化）
- [ ] UI 集成测试（预设输入、自定义输入、状态展示、多 agent 混合场景）

## 测试要点

1. **RPC contract test**：字段完整性、状态映射正确性、重调度后 nextDue 变化
2. **UI 集成测试**：预设输入、自定义输入非法校验、状态展示渲染
3. **多 agent 混合场景**：部分 never + 部分 failed 的展示
4. **边界**：heart disabled agent、gateway 刚启动（全部 never）、间隔修改后立即刷新

## 参考

- HeartbeatRunner: `src/infra/heartbeat-runner.ts` — `HeartbeatAgentState`, `resolveNextDue`, `advanceAgentSchedule`, `emitHeartbeatEvent`
- Heartbeat config: `src/auto-reply/heartbeat.ts` — `DEFAULT_HEARTBEAT_EVERY`
- Heartbeat events: `src/infra/heartbeat-events.ts` — `emitHeartbeatEvent`, `resolveIndicatorType`
- Interval parser: `src/infra/heartbeat-runner.ts` — `resolveHeartbeatIntervalMs()`
- Config schema: `src/config/zod-schema.agent-defaults.ts`, `src/config/types.agent-defaults.ts`
- 现有 RPC 模式: `src/gateway/server-methods/` 目录
- Fork 维护策略: `docs/fork/FORK_PRINCIPLES.md`
- 前置依赖 #3（软依赖）: `docs/fork/issues/003-ui-agents-per-feature-model-selectors.md`
