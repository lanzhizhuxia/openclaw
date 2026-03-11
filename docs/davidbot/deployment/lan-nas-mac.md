# OpenClaw 局域网部署指南：NAS（Gateway）+ Mac（Node）

## 架构概览

```
                         局域网 (192.168.x.x)
                               │
    ┌──────────────────────────┼──────────────────────────┐
    │                          │                          │
    │  NAS (Gateway)           │    Mac (Node)            │
    │  ┌───────────────────┐   │    ┌──────────────────┐  │
    │  │ openclaw gateway   │   │    │ openclaw node    │  │
    │  │ :18789 (ws+http)  │◄──┼────│ (WebSocket 连接)  │  │
    │  │                   │   │    │                  │  │
    │  │ IM 通道 (出站):    │   │    │ 能力:             │  │
    │  │  Telegram 轮询     │───┼──► │  camera, screen  │  │
    │  │  Discord WS       │   │    │  canvas, exec    │  │
    │  │  Slack Socket     │   │    │  location, notify│  │
    │  │  WhatsApp WS      │   │    └──────────────────┘  │
    │  │                   │   │                          │
    │  │ Control UI        │   │    浏览器访问:            │
    │  │ /healthz /readyz  │◄──┼──── http://NAS-IP:18789  │
    │  └───────────────────┘   │                          │
    └──────────────────────────┴──────────────────────────┘
```

所有流量必须经过 Gateway。Node 不对外暴露任何端口，仅作为能力宿主通过 WebSocket 连接 Gateway。

---

## Gateway 部署方式对比：Docker vs 原生

| 对比项 | Docker 部署 | 原生部署 (Node.js) |
|--------|------------|-------------------|
| **环境要求** | Docker + Docker Compose v2 | Node.js 22+, pnpm |
| **安装复杂度** | 一条命令构建镜像 | 需安装 Node.js、pnpm、构建项目 |
| **隔离性** | 容器隔离，不污染宿主系统 | 直接运行在宿主系统上 |
| **沙箱支持** | 支持 Docker-in-Docker 沙箱 | 需要宿主安装 Docker（仅沙箱功能） |
| **进程管理** | Docker Compose 自动重启 | 需自行配置 systemd / launchd |
| **资源占用** | 镜像体积 ~1GB+，内存稍高 | 更轻量，适合低配 NAS |
| **热重载** | 需重建容器或挂载源码 | 原生 `hybrid` 热重载 |
| **调试便利性** | 需 `docker compose exec/logs` | 直接访问进程和文件 |
| **文件权限** | 需注意 uid 1000 (node 用户) | 无额外权限问题 |
| **升级方式** | 重新 build 或 pull 新镜像 | `git pull && pnpm install && pnpm build` |
| **NAS 兼容性** | 群晖/威联通等均有 Docker 支持 | 需 NAS 支持 Node.js 22 |
| **功能差异** | **无差异** — 完全相同的 Gateway 进程 | **无差异** |

> **结论**：两种方式运行的是完全相同的 Gateway 代码，功能无任何差异。选择取决于你的运维偏好和 NAS 环境。
>
> - **推荐 Docker**：NAS 自带 Docker（群晖、威联通等）、不想折腾 Node.js 环境、需要沙箱隔离
> - **推荐原生**：NAS 内存紧张（<2GB）、需要频繁调试、已有 Node.js 环境

---

## 方案 A：Docker 部署 Gateway（推荐）

### A.1 准备工作

```bash
ssh user@nas-ip
git clone https://github.com/lanzhizhuxia/openclaw.git
cd openclaw
```

要求：
- Docker Engine + Docker Compose v2
- 至少 2GB RAM（构建镜像时 pnpm install 需要）
- 足够的磁盘空间存放镜像和日志

### A.2 创建 .env 文件

```bash
# 生成随机 token
GATEWAY_TOKEN=$(openssl rand -hex 32)

cat > .env << EOF
# ---- 核心配置 ----
OPENCLAW_CONFIG_DIR=$HOME/.openclaw
OPENCLAW_WORKSPACE_DIR=$HOME/.openclaw/workspace
OPENCLAW_GATEWAY_PORT=18789
OPENCLAW_BRIDGE_PORT=18790
OPENCLAW_GATEWAY_BIND=lan
OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}
OPENCLAW_IMAGE=openclaw:local

# ---- 局域网明文 WS（同网段可信环境）----
OPENCLAW_ALLOW_INSECURE_PRIVATE_WS=1

# ---- 模型 API 密钥（至少填一个）----
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# GEMINI_API_KEY=...

# ---- IM 通道（按需填写）----
# TELEGRAM_BOT_TOKEN=123456:ABCDEF...
# DISCORD_BOT_TOKEN=...
# SLACK_BOT_TOKEN=xoxb-...
# SLACK_APP_TOKEN=xapp-...
EOF

echo ""
echo "========================================="
echo "Gateway Token: ${GATEWAY_TOKEN}"
echo "请记录此 Token，Mac 连接时需要使用"
echo "========================================="
```

### A.3 构建并启动

**方式一：自动引导（推荐）**

```bash
./docker-setup.sh
```

此脚本会自动完成：构建镜像、运行引导向导、生成 token、写入 .env、启动 Gateway。

**方式二：手动构建**

```bash
# 创建数据目录
mkdir -p ~/.openclaw/identity ~/.openclaw/agents/main/agent ~/.openclaw/agents/main/sessions
mkdir -p ~/.openclaw/workspace

# 构建镜像
docker build -t openclaw:local -f Dockerfile .

# 运行引导向导
docker compose run --rm openclaw-cli onboard --mode local --no-install-daemon

# 启动 Gateway
docker compose up -d openclaw-gateway
```

**方式三：使用预构建镜像（跳过本地构建）**

```bash
export OPENCLAW_IMAGE="ghcr.io/openclaw/openclaw:latest"
./docker-setup.sh
```

### A.4 验证

```bash
# 健康检查
curl -fsS http://127.0.0.1:18789/healthz
# 期望: {"ok":true,"status":"live"}

# 就绪检查
curl -fsS http://127.0.0.1:18789/readyz

# 查看日志
docker compose logs -f openclaw-gateway

# 深度健康检查
docker compose exec openclaw-gateway \
  node dist/index.js health --token "$OPENCLAW_GATEWAY_TOKEN"
```

### A.5 Docker 日常运维

```bash
docker compose up -d openclaw-gateway       # 启动
docker compose down                         # 停止
docker compose restart openclaw-gateway     # 重启
docker compose logs -f openclaw-gateway     # 日志

# CLI 命令通过 openclaw-cli 容器执行
docker compose run --rm openclaw-cli <command>

# 例如
docker compose run --rm openclaw-cli devices list
docker compose run --rm openclaw-cli nodes status
docker compose run --rm openclaw-cli config get gateway
```

---

## 方案 B：原生部署 Gateway

### B.1 准备工作

```bash
ssh user@nas-ip

# 安装 Node.js 22+
# Ubuntu/Debian:
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证版本
node -v   # 需要 v22.x.x 或更高

# 安装 pnpm
corepack enable
```

### B.2 克隆并构建

```bash
git clone https://github.com/lanzhizhuxia/openclaw.git
cd openclaw

pnpm install --frozen-lockfile
pnpm build
pnpm ui:build
```

### B.3 配置

```bash
# 生成 token
GATEWAY_TOKEN=$(openssl rand -hex 32)

# 运行引导向导
openclaw onboard

# 设置关键配置
openclaw config set gateway.bind lan
openclaw config set gateway.auth.token "$GATEWAY_TOKEN"

echo ""
echo "========================================="
echo "Gateway Token: ${GATEWAY_TOKEN}"
echo "请记录此 Token，Mac 连接时需要使用"
echo "========================================="
```

也可以在 `~/.openclaw/.env` 中写入环境变量：

```bash
cat > ~/.openclaw/.env << EOF
OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}
OPENCLAW_ALLOW_INSECURE_PRIVATE_WS=1
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
EOF
```

### B.4 启动 Gateway

**前台运行（调试用）：**

```bash
openclaw gateway --port 18789 --bind lan
# 带详细日志
openclaw gateway --port 18789 --bind lan --verbose
```

**注册为系统服务（推荐）：**

```bash
# macOS (launchd)
openclaw gateway install
openclaw gateway status

# Linux (systemd)
openclaw gateway install
systemctl --user enable --now openclaw-gateway.service
# 保持登出后仍运行
sudo loginctl enable-linger $(whoami)
```

### B.5 验证

```bash
openclaw gateway status         # 查看运行状态
openclaw channels status --probe  # 检查通道就绪
openclaw health                 # 深度健康检查
openclaw logs --follow          # 实时日志
```

### B.6 原生日常运维

```bash
openclaw gateway status          # 状态
openclaw gateway restart         # 重启
openclaw gateway stop            # 停止
openclaw devices list            # 设备列表
openclaw nodes status            # Node 状态
openclaw config get gateway      # 查看配置
openclaw config set <key> <val>  # 修改配置
openclaw doctor                  # 诊断修复
```

---

## 配置 IM 通道（两种部署方式通用）

以下通道默认使用**出站连接**，Gateway 主动连接 IM 平台，**不需要对外暴露任何端口**：

| 通道 | 传输方式 | 方向 | 需要暴露端口？ |
|------|---------|------|--------------|
| Telegram | HTTP 长轮询 (默认) | 出站 | 否 |
| Discord | WebSocket | 出站 | 否 |
| Slack | WebSocket Socket Mode (默认) | 出站 | 否 |
| WhatsApp | WebSocket (Baileys) | 出站 | 否 |
| Signal | SSE + JSON-RPC (本地) | 出站 | 否 |
| Matrix | HTTP 长轮询 /sync | 出站 | 否 |
| 飞书 | WebSocket (默认) | 出站 | 否 |

> 注意：部分通道支持 Webhook 入站模式（Telegram webhook 端口 8787、Slack HTTP 模式端口 18789、
> 飞书 webhook 端口 3000 等），如需使用需额外暴露对应端口。**默认模式无需暴露。**

### 添加通道

Docker 部署用 `docker compose run --rm openclaw-cli`，原生部署直接用 `openclaw`。以下以 `$CLI` 代替：

```bash
# Docker 部署:
CLI="docker compose run --rm openclaw-cli"

# 原生部署:
CLI="openclaw"

# Telegram（长轮询，无需暴露端口）
$CLI channels add --channel telegram --token "<BOT_TOKEN>"

# Discord（WebSocket，无需暴露端口）
$CLI channels add --channel discord --token "<BOT_TOKEN>"

# WhatsApp（扫码登录，WebSocket，无需暴露端口）
$CLI channels login

# Slack（Socket Mode，无需暴露端口，需要 BOT_TOKEN + APP_TOKEN 环境变量）
$CLI channels add --channel slack
```

---

## Mac 连接为 Node

### 安装 OpenClaw CLI

```bash
# 方式 A：npm 全局安装
npm install -g openclaw

# 方式 B：从源码构建
git clone https://github.com/lanzhizhuxia/openclaw.git
cd openclaw && pnpm install && pnpm build
```

### 启动 Node 连接

将 `<NAS-IP>` 替换为 NAS 的局域网 IP（如 `192.168.1.100`）：

```bash
# 设置 token
export OPENCLAW_GATEWAY_TOKEN="<Gateway Token>"

# 前台运行
openclaw node run \
  --host <NAS-IP> \
  --port 18789 \
  --display-name "My Mac"
```

注册为后台服务：

```bash
openclaw node install \
  --host <NAS-IP> \
  --port 18789 \
  --display-name "My Mac"

openclaw node restart
```

macOS 用户也可以使用 **OpenClaw 菜单栏应用**，它会自动以 Node 模式连接 Gateway。

### 审批设备配对

首次连接需在 Gateway 端审批：

```bash
# Docker 部署
docker compose run --rm openclaw-cli devices list
docker compose run --rm openclaw-cli devices approve <requestId>
docker compose run --rm openclaw-cli nodes status

# 原生部署
openclaw devices list
openclaw devices approve <requestId>
openclaw nodes status
```

> 同局域网直连（loopback 或相同 tailnet IP）的设备可自动审批。

### 配置 exec 路由到 Node（可选）

让 AI Agent 的命令在 Mac 上执行：

```bash
$CLI config set tools.exec.host node
$CLI config set tools.exec.node "My Mac"
```

---

## 访问 Control UI

局域网内浏览器访问：

```
http://<NAS-IP>:18789
```

首次访问：
1. 在设置中输入 Gateway Token
2. 审批浏览器设备配对

```bash
# 获取 dashboard 链接
$CLI dashboard --no-open

# 审批浏览器设备
$CLI devices list
$CLI devices approve <requestId>
```

---

## 端口说明

| 端口 | 用途 | 对局域网开放？ |
|------|------|--------------|
| **18789** | Gateway 主端口 (WebSocket + HTTP + Control UI) | **是（必须）** |
| 18790 | Bridge（内部扩展/沙箱通信） | 否 |
| 18791 | 浏览器控制服务器（内部） | 否 |
| 18793 | Canvas 独立服务器（内部） | 否 |
| 18800-18899 | Chromium CDP 端口（内部） | 否 |

**NAS 防火墙只需对局域网网段开放 18789/TCP。**

---

## 可选：启用 TLS 加密

局域网内 TLS 是可选的。如果你信任网络环境，使用 `OPENCLAW_ALLOW_INSECURE_PRIVATE_WS=1` 走明文即可。

如需加密：

```bash
# 启用 TLS（自动生成自签名证书，强制 TLSv1.3）
$CLI config set gateway.tls.enabled true

# 重启 Gateway
# Docker:
docker compose restart openclaw-gateway
# 原生:
openclaw gateway restart
```

Mac Node 使用 TLS 连接：

```bash
openclaw node run \
  --host <NAS-IP> \
  --port 18789 \
  --display-name "My Mac" \
  --tls \
  --tls-fingerprint "<证书 SHA-256 指纹>"
```

TLS 支持的能力：

| 特性 | 说明 |
|------|------|
| 自签名证书 | 自动生成 RSA 2048，有效期 10 年 |
| 自定义证书 | `gateway.tls.certPath` / `gateway.tls.keyPath` |
| CA 证书 | `gateway.tls.caPath`（支持 mTLS） |
| 最低版本 | 强制 TLSv1.3 |
| 证书指纹锁定 | `--tls-fingerprint`（SHA-256） |

---

## 可选：Cloudflare Zero Trust（跨网络访问）

如果 NAS 和 Mac 不在同一局域网，可通过 Cloudflare Tunnel 暴露 Gateway：

```bash
# 安装 cloudflared 并创建隧道
cloudflared tunnel create openclaw
cloudflared tunnel route dns openclaw openclaw.yourdomain.com

# 配置隧道指向 Gateway
# ~/.cloudflared/config.yml
# tunnel: <tunnel-id>
# credentials-file: ~/.cloudflared/<tunnel-id>.json
# ingress:
#   - hostname: openclaw.yourdomain.com
#     service: http://127.0.0.1:18789
#   - service: http_status:404
```

Gateway 配置 Trusted Proxy Auth 委托认证给 Cloudflare Access：

```json
{
  "gateway": {
    "bind": "loopback",
    "trustedProxies": ["127.0.0.1", "::1"],
    "auth": {
      "mode": "trusted-proxy",
      "trustedProxy": {
        "userHeader": "cf-access-authenticated-user-email",
        "requiredHeaders": ["cf-access-jwt-assertion"],
        "allowUsers": ["you@example.com"]
      }
    }
  }
}
```

此时 Gateway 绑定 loopback，仅接受来自 cloudflared 的请求。

需要对外暴露的端口：

| 端口 | 条件 |
|------|------|
| 18789 (通过 Tunnel) | 必须 — Gateway 主端口 |
| 8787 (通过 Tunnel) | 仅 Telegram Webhook 模式 |
| 3000 (通过 Tunnel) | 仅飞书 Webhook 模式 |

---

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| `refusing to bind gateway ... without auth` | 非 loopback 绑定但未设置 token | 设置 `OPENCLAW_GATEWAY_TOKEN` |
| `EADDRINUSE` | 端口被占用 | `openclaw gateway --force` 或更换端口 |
| `Gateway start blocked: set gateway.mode=local` | 配置为 remote 模式 | `$CLI config set gateway.mode local` |
| Node 连接 `unauthorized` | Token 不匹配 | 检查两端 token 是否一致 |
| Node 连接 `pairing required` | 设备未审批 | `$CLI devices list` → `$CLI devices approve <id>` |
| Control UI `disconnected (1008)` | 设备未配对或 token 错误 | `$CLI dashboard --no-open` 重新获取链接 |
| Docker EACCES 权限错误 | 宿主目录 uid 不匹配 | `sudo chown -R 1000:1000 ~/.openclaw` |
| `ws://` 连接被拒绝 | 未设置明文 WS 放行 | 设置 `OPENCLAW_ALLOW_INSECURE_PRIVATE_WS=1` |
