# Docker: QMD 记忆搜索后端支持

## Summary

QMD 记忆后端（`memory.backend = "qmd"`）提供本地 BM25 + 向量混合搜索，显著优于内置 SQLite 后端的检索质量。但 QMD 是外部二进制（`bun install -g https://github.com/tobi/qmd`），官方 Docker 镜像中未包含，容器化部署（尤其 NAS Docker）无法开箱使用。

## 方案决策

**选择：Derivative Image（派生镜像）— `Dockerfile.qmd`**

创建独立的 `Dockerfile.qmd`，基于本地构建的 base image 叠加 Bun + QMD。**不修改上游 `Dockerfile`**。

> 此方案遵循二开原则：[Fork 维护策略](../FORK_PRINCIPLES.md)

### 方案对比（含 merge 冲突评估）

| 方案                                             | Merge 冲突风险                          | 运维风险                                       | 选择    |
| ------------------------------------------------ | --------------------------------------- | ---------------------------------------------- | ------- |
| **A. `Dockerfile.qmd` 派生镜像**                 | **很低** — 完全不碰上游文件             | 低                                             | ✅ 选择 |
| B. 上游 Dockerfile 加 `OPENCLAW_INSTALL_QMD` ARG | **中等** — runtime 区域是 merge hotspot | 低                                             | ❌      |
| C. 首次启动脚本安装                              | 很低                                    | **高** — 不可复现，启动慢                      | ❌      |
| D. Sidecar 容器                                  | 很低                                    | 中 — `qmd-manager.ts` 使用 `spawn()`，需改源码 | ❌      |

### 为什么选 Derivative Image？

**上游现状调研（2026-03-14）：**

1. **上游 Dockerfile 是活跃的 merge hotspot** — 最近数月有 slim image (#38479)、cache reuse (#40351)、runtime trim (#40307)、extension opt-in (#32223)、sandbox opt-in (#29974) 等大改动。runtime 阶段的 apt/install 区域改动频繁。
2. **QMD 从未出现在上游 Dockerfile 中**，也无任何相关 Issue/PR。上游短期无计划支持。
3. **memory-lancedb Docker 支持曾被尝试又被 revert**（commit 2ab6313d9 → 22b2a77b3），说明上游对 Docker 中 memory 扩展持谨慎态度。
4. **Bun 只在 build stage 存在**，runtime image 不含 Bun。

Derivative Image 方式让上游 Dockerfile 保持零改动，rebase 时只需维护 fork 独有文件。

### 为什么不用原来的 in-file ARG 方案？

虽然遵循了 `OPENCLAW_INSTALL_BROWSER` / `OPENCLAW_INSTALL_DOCKER_CLI` 模式，但上游 runtime 阶段改动频繁（平均每月 1-2 次），每次 rebase 都可能产生冲突。作为二开项目，维护成本不值得。

## 目标架构（x86_64 only）

```
NAS (x86_64, Docker)
┌─────────────────────────────────────────┐
│  openclaw-qmd container                 │
│  (FROM openclaw-base:local)             │
│  ┌───────────────────────────────────┐  │
│  │  node openclaw.mjs gateway        │  │
│  │       │                           │  │
│  │       ▼ spawn()                   │  │
│  │  /opt/bun/bin/qmd search ...      │  │
│  │       │                           │  │
│  │       ▼                           │  │
│  │  QMD index (BM25 + vector)        │  │
│  └───────────────────────────────────┘  │
│                                         │
│  Volumes:                               │
│    /home/node/.openclaw  ← config       │
│    /home/node/.qmd       ← QMD models   │
└─────────────────────────────────────────┘
```

## 实现方案

### 1. 创建 `Dockerfile.qmd`（fork 独有文件）

```dockerfile
# Dockerfile.qmd — Derivative image adding QMD memory backend
# Build: docker build -t openclaw-base . && docker build -t openclaw-qmd -f Dockerfile.qmd .
#
# This file is fork-only. It does NOT modify the upstream Dockerfile.
# See: docs/fork/FORK_PRINCIPLES.md

ARG BASE_IMAGE=openclaw-base:local
FROM ${BASE_IMAGE}

USER root

# x86_64 guard — QMD + node-llama-cpp native bindings are amd64 only
RUN TARGETARCH="$(dpkg --print-architecture)"; \
    if [ "$TARGETARCH" != "amd64" ]; then \
      echo "ERROR: QMD is supported only on amd64 (got $TARGETARCH)" >&2; \
      exit 1; \
    fi

# Install Bun runtime (required by QMD)
ENV BUN_INSTALL=/opt/bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
RUN curl -fsSL https://bun.sh/install | bash && \
    chmod -R a+rX /opt/bun

# Install QMD globally via Bun
RUN bun install -g https://github.com/tobi/qmd && \
    qmd --version

# Restore non-root user
USER node
```

**关键细节：**

- `BASE_IMAGE` 可配置 — 默认使用本地构建的 base image，也可指向固定 tag/digest
- `BUN_INSTALL=/opt/bun` — 系统级路径，root 安装后 `node` 用户可读
- `ENV PATH` 全局生效 — `node` 用户运行时 PATH 自动包含 `/opt/bun/bin`
- QMD 二进制最终路径：`/opt/bun/bin/qmd`
- 非 amd64 构建时 fast-fail，给出清晰错误信息
- `qmd --version` 作为安装验证

### 2. 构建 Pipeline（两步构建）

```bash
# Step 1: 构建 base image（使用上游 Dockerfile，零改动）
docker build -t openclaw-base:local .

# Step 2: 构建 QMD image（叠加层）
docker build -t openclaw-qmd:local -f Dockerfile.qmd .
```

可选：用 `docker-compose.yml` 的 `build` 配置自动化：

```yaml
services:
  openclaw-gateway:
    build:
      context: .
      dockerfile: Dockerfile.qmd
      args:
        BASE_IMAGE: openclaw-base:local
```

### 3. docker-compose.qmd.yml（fork 独有 compose overlay）

创建独立的 compose overlay，**不修改上游 `docker-compose.yml`**：

```yaml
# docker-compose.qmd.yml — QMD overlay (fork-only)
# Usage: docker compose -f docker-compose.yml -f docker-compose.qmd.yml up -d
services:
  openclaw-gateway:
    build:
      context: .
      dockerfile: Dockerfile.qmd
    volumes:
      ## QMD models and index data
      ## Create dir first: mkdir -p ./data/qmd && chown 1000:1000 ./data/qmd
      - ${OPENCLAW_QMD_DIR:-./data/qmd}:/home/node/.qmd
```

### 4. 首次运行引导流程

```bash
# 1. 构建两层镜像
docker build -t openclaw-base:local .
docker build -t openclaw-qmd:local -f Dockerfile.qmd .

# 2. 创建 QMD 数据目录（uid 1000 = node 用户）
mkdir -p ./data/qmd
sudo chown -R 1000:1000 ./data/qmd

# 3. 在 openclaw.json 中启用 QMD（见下方配置示例）

# 4. 启动（使用 compose overlay）
docker compose -f docker-compose.yml -f docker-compose.qmd.yml up -d

# 5. 验证 QMD 可用
docker compose exec openclaw-gateway qmd --version

# 6. 初始化 QMD 索引（首次使用需要）
docker compose exec openclaw-gateway qmd update
```

**注意：** GGUF 模型文件会在首次 `qmd embed` 时自动下载到 `/home/node/.qmd/models/`，通过 volume 挂载持久化到宿主机。首次下载约 500MB+，后续启动不再下载。

### 5. 配置示例

`openclaw.json` 最小 QMD 配置：

```json
{
  "memory": {
    "backend": "qmd",
    "qmd": {
      "command": "/opt/bun/bin/qmd"
    }
  }
}
```

完整配置（含性能调优）：

```json
{
  "memory": {
    "backend": "qmd",
    "qmd": {
      "command": "/opt/bun/bin/qmd",
      "searchMode": "search",
      "sessions": {
        "enabled": true
      },
      "update": {
        "onBoot": true,
        "interval": "5m",
        "embedInterval": "60m"
      },
      "limits": {
        "maxResults": 6,
        "timeoutMs": 4000
      }
    }
  }
}
```

> **Embedding 建议：** NAS CPU 跑本地 embedding（node-llama-cpp）较慢。如果你有 OpenAI/Gemini API key，建议配置远程 embedding provider 以获得更好性能。QMD 的 embedding provider 选择遵循 OpenClaw 的全局 `memory.embedding` 配置。

### 6. 镜像体积预算

| 组件                            | 增量       |
| ------------------------------- | ---------- |
| Bun 运行时                      | ~70MB      |
| QMD + node-llama-cpp            | ~100-150MB |
| **总计（不含模型）**            | **~180MB** |
| GGUF 模型（volume，不在镜像中） | ~500MB+    |

对比：`OPENCLAW_INSTALL_BROWSER` 增加 ~300MB，`OPENCLAW_INSTALL_DOCKER_CLI` 增加 ~50MB。

## 技术澄清（原 issue 勘误）

1. ~~"qmd update/embed 需兼容容器 Node.js 版本"~~ → **错误**。QMD 使用 Bun 运行时，不依赖容器的 Node.js。真正的兼容性风险是 Bun + node-llama-cpp 原生 addon 的 ABI 和 glibc 版本（bookworm 的 glibc 2.36 足够）。

2. ~~"QMD integration ~900 LOC"~~ → 实际 `qmd-manager.ts` 约 **2100 行**。

3. ARM/aarch64 不在本 issue 范围内。目标 NAS 为 **x86_64 架构**。

## 验收标准

- [ ] `Dockerfile.qmd` 文件存在，基于 `openclaw-base:local` 构建
- [ ] 两步构建（base → qmd）在 `amd64` 上成功
- [ ] 非 `amd64` 构建时 fast-fail 并输出清晰错误信息
- [ ] 运行时 `node` 用户（uid 1000）PATH 能解析 `qmd`；容器内 `qmd --version` 正常工作
- [ ] 镜像层不包含 GGUF 模型文件（模型通过 volume 持久化）
- [ ] `docker-compose.qmd.yml` 提供 QMD overlay（volume + build 配置）
- [ ] 上游 `Dockerfile` 和 `docker-compose.yml` 零改动
- [ ] OpenClaw 能通过配置的 `memory.qmd.command` spawn QMD 并完成至少一次记忆搜索 roundtrip
- [ ] 文档/注释说明首次运行引导步骤

## 实现检查清单

- [ ] 创建 `Dockerfile.qmd`（fork 独有）
- [ ] 创建 `docker-compose.qmd.yml`（fork 独有 compose overlay）
- [ ] 部署文档 (`docs/fork/deployment/lan-nas-mac.md`): 补充 QMD 启用说明
- [ ] 构建测试: 两步构建成功
- [ ] 运行时测试: 容器内 `qmd --version` + `qmd search` 正常

## 工作量预估

**1-2 小时**（创建 Dockerfile.qmd + compose overlay + 文档 + 冒烟测试）

## 参考

- QMD repo: https://github.com/tobi/qmd
- OpenClaw QMD integration: `src/memory/qmd-manager.ts` (~2100 LOC)
- Config types: `src/config/types.memory.ts` — `MemoryQmdConfig`, `MemoryQmdMcporterConfig`
- Backend resolution: `src/memory/backend-config.ts` — `resolveMemoryBackendConfig()`
- mcporter bridge: `src/memory/qmd-manager.ts` — `runMcporter()`, `runQmdSearchViaMcporter()`
- 上游 Docker opt-in 先例: `Dockerfile` L157-203 (`OPENCLAW_INSTALL_BROWSER`, `OPENCLAW_INSTALL_DOCKER_CLI`)
- 上游 merge hotspot 证据: #38479 (slim), #40351 (cache), #40307 (trim), #32223 (extensions), #29974 (sandbox)
- memory-lancedb Docker 尝试被 revert: commit 2ab6313d9 → 22b2a77b3
- Fork 维护策略: `docs/fork/FORK_PRINCIPLES.md`
