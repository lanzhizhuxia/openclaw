# Fork 维护策略

本项目是 OpenClaw 的二次开发（fork），目标是构建个人多 Agent 系统。以下原则指导所有二开工作，确保与上游的长期可合并性。

## 核心原则

### 1. 上游文件零改动优先

**能不改上游文件，就不改。** 优先使用以下方式扩展功能：

| 扩展方式      | 说明                                          | 适用场景    |
| ------------- | --------------------------------------------- | ----------- |
| 派生文件      | `Dockerfile.qmd`、`docker-compose.qmd.yml`    | Docker 定制 |
| Overlay 配置  | compose overlay (`-f base.yml -f custom.yml`) | 部署配置    |
| Fork 独有目录 | `docs/fork/`、新增的独立文件                  | 文档、脚本  |
| 扩展/插件机制 | OpenClaw extensions、skills                   | 功能扩展    |
| 配置文件      | `openclaw.json`、环境变量                     | 行为定制    |

**❌ 避免：** 直接修改 `Dockerfile`、`docker-compose.yml`、`src/` 核心模块等上游维护的文件。

### 2. 改动前必须评估 Merge 风险

每个 issue 实现前，必须回答：

1. **上游这个文件/区域最近改动频率如何？** （`git log --oneline -- <file> | head -20`）
2. **是否有上游 Issue/PR 在做类似的事？** （`gh search issues/prs`）
3. **能否用 fork 独有文件替代上游文件修改？**
4. **如果必须改上游文件，改动是否集中在文件末尾？** （末尾追加比中间插入冲突风险低）

### 3. Merge 冲突分级

| 风险等级 | 定义                                      | 策略                       |
| -------- | ----------------------------------------- | -------------------------- |
| **很低** | Fork 独有文件（上游不存在）               | 直接创建                   |
| **低**   | 上游文件末尾追加、注释中添加              | 可接受，注明 `# fork-only` |
| **中等** | 上游文件中间修改，该区域每月有 1-2 次变动 | 尽量避免，寻找替代方案     |
| **高**   | 上游核心逻辑修改，该区域改动频繁          | 禁止，必须找替代方案       |

### 4. Fork 独有文件命名约定

- Docker 相关: `Dockerfile.<purpose>`, `docker-compose.<purpose>.yml`
- 文档: `docs/fork/` 目录下
- 脚本: `scripts/fork/` 目录下（如需要）
- 配置: `.env.fork`（如需要）

### 5. Rebase 策略

```bash
# 定期从上游同步
git fetch upstream
git rebase upstream/main

# 冲突处理优先级：
# 1. 上游改动优先（保留上游版本）
# 2. 检查 fork 改动是否仍然需要
# 3. 在 fork 独有文件中重新实现（如冲突严重）
```

## 检查清单模板

每个 issue 在实现方案确定前，填写以下检查：

```markdown
### Fork 影响评估

- [ ] 列出所有需要修改的文件
- [ ] 每个文件标注：fork 独有 / 上游文件追加 / 上游文件修改
- [ ] 上游文件修改项已评估 merge 冲突风险等级
- [ ] 风险为"中等"以上的项已尝试替代方案
- [ ] 所有 fork 独有文件已按命名约定命名
```

## 上游观测记录

### Dockerfile (高频变动区域)

**最后观测：2026-03-14**

- runtime 阶段 apt/install 区域（L120-203）: **月均 1-2 次改动**
- 已有 opt-in ARG: `OPENCLAW_EXTENSIONS`, `OPENCLAW_INSTALL_BROWSER`, `OPENCLAW_INSTALL_DOCKER_CLI`, `OPENCLAW_DOCKER_APT_PACKAGES`
- 趋势: slim image、cache 优化、runtime 瘦身持续进行中
- 结论: **不在此文件中添加 fork 改动**

### docker-compose.yml (中频变动)

**最后观测：2026-03-14**

- 有 sandbox overlay 先例 (`docker-compose.sandbox.yml`)
- 结论: **使用 compose overlay 方式扩展**

### src/memory/ (活跃开发)

**最后观测：2026-03-14**

- QMD 相关 bug fix 持续进行
- 记忆架构稳定（双后端: builtin SQLite-vec + QMD）
- 结论: **不改源码，通过配置 + Dockerfile 叠加层解决**
