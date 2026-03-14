# TenBox 调研笔记

> 调研日期: 2026-03-11
> 项目地址: https://github.com/78/tenbox
> 当前版本: v0.2.5 (GPL v3)

## 项目定位

TenBox 是一个开源跨平台 VMM（虚拟机监视器），核心目标是让 AI Agent 在隔离的 Linux VM 中安全运行。本质上是一个面向 Agent 沙箱场景裁剪过的轻量 QEMU 替代品。

## 技术架构

- **语言**: C++ 66%, Shell 13%, Swift 9%, ObjC++ 4%, Python 4%
- **两进程设计**: GUI 管理进程 + 每个 VM 独立的 runtime 进程，通过 Unix socket (macOS) / Named Pipe (Windows) 通信
- **macOS**: Apple Hypervisor Framework (HVF), SwiftUI/AppKit, 仅 Apple Silicon
- **Windows**: WHVP, Win32 原生 GUI
- **Guest 架构**: x86_64 (Windows 宿主) 和 aarch64 (macOS 宿主)

## 资源需求

| 资源 | 默认值            | 实际跑 Agent 建议                                |
| ---- | ----------------- | ------------------------------------------------ |
| 内存 | 256 MB            | 2-4 GB（跑 Node + Chromium + XFCE 必须手动调高） |
| CPU  | 1 vCPU (最高 128) | 2-4 vCPU                                         |
| 磁盘 | 20 GB qcow2 (COW) | 实际占用 5-8 GB                                  |

内存是**独占预分配**的，给 VM 多少宿主就少多少。

## 网络

- 用户态 NAT (lwIP): Gateway 10.0.2.2, Guest 10.0.2.15 (DHCP), DNS 8.8.8.8
- 出站 TCP 经 lwIP 代理到宿主 socket，UDP 直接中继
- 端口转发: `--forward H:G`（仅 TCP）
- 无桥接/直通模式，所有流量经宿主

## 文件共享

- virtiofs: `--share /host/path:/guest/mount`，可重复，支持只读
- GUI 也可配置，持久化在 vm.json
- macOS 上 Docker Desktop 也用 virtiofs，两者文件共享性能基本一致

## 默认 Guest 环境

Debian Bookworm + XFCE 4 桌面 + Chromium + Node.js 22 + Agent 工具链

## 功能特性

- VirtIO MMIO: 块存储、网络、GPU (SPICE)、输入、串口、声音、文件系统
- 剪贴板双向同步 (SPICE vdagent)
- qemu-guest-agent 集成
- 多 VM 管理 (JSON 持久化)
- 音频: WASAPI (Windows) / CoreAudio (macOS)

## TenBox vs Docker on Mac 对比

| 维度          | TenBox            | Docker                               |
| ------------- | ----------------- | ------------------------------------ |
| 隔离级别      | 独立 VM (HVF)     | 容器 (但 Docker Desktop 底层也是 VM) |
| 图形界面      | 完整 XFCE + SPICE | 无，需额外配 VNC                     |
| 浏览器        | 内置 Chromium     | 需自己装 + headless                  |
| 剪贴板        | 双向同步          | 无                                   |
| 启动速度      | 15-30s            | 1-2s                                 |
| 单 Agent 内存 | 2-4 GB 独占       | ~200 MB 动态共享                     |
| 磁盘          | 5-8 GB            | 200-400 MB                           |
| 镜像生态      | 仅官方 Debian     | Docker Hub 海量                      |
| 多实例        | 每个都是完整 VM   | 轻松几十个容器                       |
| 成熟度        | v0.2.5 早期       | 十几年生态                           |

### 结论

- **需要 Agent 操作浏览器/桌面 (computer use)** → TenBox 有价值
- **只跑 Node 执行代码** → Docker 全面优于 TenBox (内存 1/10~1/20, 启动快 10x+)

## OpenClaw Gateway + TenBox 分离部署

可行方案: Gateway 跑 NAS (Linux, Node 22+, systemd), TenBox 跑 Mac。

```
NAS (Linux)                          Mac (Apple Silicon)
┌──────────────────────┐             ┌─────────────────────────┐
│ OpenClaw Gateway     │◄── 网络 ──→│ TenBox VM (Debian arm64)│
│ - 端口 18789         │             │   - Node.js 22          │
│ - 消息通道           │             │   - Agent 执行代码       │
│ - AI 模型调用        │             │   - NAT 访问 Gateway    │
└──────────────────────┘             └─────────────────────────┘
```

Gateway 远程访问方式: SSH 隧道 / Tailscale / `--bind lan` + auth token

注意事项:

- TenBox 不感知 Gateway，Agent 需自行配置连接
- 网络链路: VM (10.0.2.15) → Mac NAT → NAS，排查较复杂
- TenBox 仅限 macOS Apple Silicon，NAS 上跑不了
- 如果不需要桌面，Docker 是更优选择

## 社区反馈 (GitHub Issues)

- #13: ESXi 嵌套虚拟化性能差
- #12: 端口转发时 openclaw token 问题
- #8: initrd.gz SHA256 校验失败
- #7: USB 设备直通需求
- #4: 浏览器登录问题
- #3: AI 模型访问外部网站限制
