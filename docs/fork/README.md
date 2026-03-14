# 二开文档

个人二次开发相关的调研、设计和操作文档。

> **重要：** 所有二开工作必须遵循 [Fork 维护策略](FORK_PRINCIPLES.md)，确保与上游的长期可合并性。

## 目录结构

```
fork/
├── FORK_PRINCIPLES.md  # Fork 维护策略（二开核心原则）
├── research/           # 技术调研（第三方工具、竞品分析、可行性评估）
├── deployment/         # 部署方案（NAS、VM、Docker、网络拓扑）
├── architecture/       # 架构设计（决策记录、系统设计、接口约定）
├── issues/             # Issue 规格文档
└── guides/             # 操作手册（环境搭建、日常运维、故障排查）
```

## 文档索引

### 核心

- [FORK_PRINCIPLES.md](FORK_PRINCIPLES.md) - Fork 维护策略（**每个 issue 实现前必读**）

### issues/

- [002-docker-qmd-memory-backend.md](issues/002-docker-qmd-memory-backend.md) - Docker QMD 记忆搜索后端支持
- [003-ui-agents-per-feature-model-selectors.md](issues/003-ui-agents-per-feature-model-selectors.md) - Agents 面板按功能绑定模型选择器
- [004-ui-agents-heartbeat-config-status.md](issues/004-ui-agents-heartbeat-config-status.md) - Agents 面板心跳间隔配置 + 状态展示

### research/

- [tenbox.md](research/tenbox.md) - TenBox VM 调研（AI Agent 沙箱方案）

### deployment/

- [lan-nas-mac.md](deployment/lan-nas-mac.md) - NAS + Mac 局域网部署指南

### architecture/

（待补充）

### guides/

（待补充）
