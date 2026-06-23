# XiaoPaw TypeScript Runtime

XiaoPaw（小爪子）TypeScript 版是 Python 版 `xiaopow/` 的运行链路迁移实现：基于飞书 WebSocket、LangChain Agent、Skills 生态和 AIO-Sandbox，提供一个可在本地或内网部署的飞书工作助手。

它的核心目标不是“把 Python 文件逐行翻译成 TypeScript”，而是保持 XiaoPaw 的关键运行不变量：

```text
飞书消息 / TestAPI
  -> InboundMessage
  -> routingKey 会话归属
  -> Runner 串行队列
  -> Session 历史
  -> Main Agent
  -> SkillLoader
  -> Sub-Agent / AIO-Sandbox
  -> Sender 回写飞书
```

## 核心功能

- **飞书全场景接入**：支持单聊 `p2p`、群聊 `group`、话题群 `thread`。
- **per-routingKey 串行队列**：同一对话按顺序处理，不同对话并行处理。
- **LangChain Main Agent**：主 Agent 只暴露 `skill_loader` 一个入口，降低工具选择复杂度。
- **Skills 渐进式披露**：先给 Agent 看 Skill 菜单，按需加载完整 `SKILL.md`。
- **AIO-Sandbox 隔离执行**：task 型 Skill 在 Docker 沙盒中执行，宿主机只暴露受控 workspace。
- **凭证隔离**：飞书、百度等凭证写入 `data/workspace/.config/*.json`，不进入 LLM prompt。
- **Session 持久化**：`data/sessions/index.json` + `s-*.jsonl` 记录 active session 和对话历史。
- **Slash 命令**：支持 `/new`、`/verbose`、`/status`、`/help`。
- **CronService**：支持 `at`、`every`、`cron` 三类定时任务，任务通过 Runner 正常链路注入。
- **TestAPI**：本地 HTTP 调试入口，方便在不操作飞书客户端时注入测试消息。
- **Prometheus Metrics**：提供 `/metrics`，观察飞书事件、Runner 队列、HTTP 请求和错误。
- **Agent trace**：主 Agent stream events 可写入 `data/traces/*.jsonl`。

当前限制：

- 图片附件可以被识别和下载，但“基于图片像素内容做视觉理解”尚未作为稳定 Skill 接入。
- TypeScript 版使用 LangChain 重新实现 Agent 层，不追求完全复刻 Python/CrewAI 内部事件细节。

## 内置 Skills

Skill 资源位于 `src/skills/`，清单见 `src/skills/load_skills.yaml`。

| Skill | 类型 | 能力 |
| --- | --- | --- |
| `pdf` | task | PDF 解析、文本提取、格式转换 |
| `docx` | task | Word 文档读取与处理 |
| `pptx` | task | PowerPoint 文档读取与处理 |
| `xlsx` | task | Excel 表格读取与处理 |
| `feishu_ops` | task | 飞书文档、表格、消息、日程等操作脚本 |
| `scheduler_mgr` | task | 定时任务创建、查看、更新、删除 |
| `baidu_search` | task | 百度千帆搜索 |
| `web_browse` | task | 网页内容提取和浏览器自动化 |
| `history_reader` | reference | 分页读取当前会话历史，不启动沙盒 |
| `memory-save` | task | 写入文件系统记忆 |
| `write-output` | task | 写入工作产出文件 |
| `skill-creator` | task | 创建或修改 Skill 文件 |

## 目录结构

```text
src/xiaopaw/
├── main.ts                  # 进程入口，组合完整 XiaoPaw runtime
├── models.ts                # InboundMessage / Attachment / SenderProtocol
├── runner.ts                # Runner：队列、slash 命令、附件、Agent 调用、回复
├── config.ts                # config.yaml 加载、环境变量展开、zod schema
├── agents/
│   ├── main-agent.ts        # LangChain Main Agent 工厂
│   └── models.ts            # structured output schema
├── api/
│   ├── capture-sender.ts    # TestAPI 专用 SenderProtocol
│   ├── test-server.ts       # Bun HTTP TestAPI
│   └── schemas.ts           # TestAPI request/response schema
├── cleanup/
│   └── service.ts           # workspace 清理 + 凭证落盘
├── cron/
│   ├── models.ts            # tasks.json 数据模型
│   └── service.ts           # CronService：热加载 + Runner 注入
├── feishu/
│   ├── listener.ts          # 飞书 WebSocket 事件 -> InboundMessage
│   ├── sender.ts            # 飞书消息发送/卡片更新/重试
│   ├── downloader.ts        # 飞书附件下载到 session workspace
│   └── session-key.ts       # routingKey 解析
├── observability/
│   ├── metrics.ts           # Prometheus registry
│   └── metrics-server.ts    # /metrics HTTP server
└── session/
    ├── manager.ts           # SessionManager
    └── models.ts            # session 数据模型
```

共享层目录：

```text
src/tools/skill-loader-tool.ts
src/tools/skill-loader/*
src/skills/*
src/llm/aliyun-qwen-chat-model.ts
src/helper/file-logger.ts
src/helper/agent-stream.ts
```

## 环境准备

依赖：

- Bun
- Docker
- 飞书开放平台自建应用
- 通义千问 API Key

安装依赖：

```bash
cd learn_langchain
bun install
```

必要环境变量：

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
export QWEN_API_KEY="sk-xxx"
export BAIDU_API_KEY="xxx" # 使用 baidu_search Skill 时需要
```

可选环境变量：

```bash
export DASHSCOPE_API_KEY="sk-xxx"    # QWEN_API_KEY 的替代项
export QWEN_API_BASE="https://dashscope.aliyuncs.com/compatible-mode/v1"
export QWEN_DEBUG_PAYLOAD=1
export XIAOPAW_CONFIG="./config.yaml"
```

## 配置 config.yaml

建议真实密钥通过环境变量注入，不要把密钥直接写进 `config.yaml`。

```yaml
workspace:
  id: "xiaopaw-default"
  name: "XiaoPaw 工作助手"

feishu:
  app_id: "${FEISHU_APP_ID}"
  app_secret: "${FEISHU_APP_SECRET}"
  allowed_chats: []

baidu:
  api_key: "${BAIDU_API_KEY}"

agent:
  model: "qwen3.6-max-preview"
  sub_agent_model: "qwen3.6-max-preview"
  sub_agent_max_iter: 20
  timeout_s: 300

skills:
  local_dir: "./src/skills"

sandbox:
  url: "http://localhost:8022/mcp"
  workspace_dir: "/workspace"

session:
  max_history_turns: 20

runner:
  queue_idle_timeout_s: 300

sender:
  max_retries: 3
  retry_backoff: [1, 2, 4]

data_dir: "./data"

debug:
  enable_test_api: true
  test_api_host: "127.0.0.1"
  test_api_port: 9090
```

安全建议：

```gitignore
config.yaml
data/
```

原因：

- `config.yaml` 可能包含飞书、LLM、百度等密钥；
- `data/` 包含 session 历史、附件、workspace 输出、Agent trace 和 `.config/*.json` 凭证文件。

## 启动 AIO-Sandbox

```bash
cd learn_langchain
docker compose -f sandbox-docker-compose.yaml up -d
```

Sandbox MCP 端点：

```text
http://localhost:8022/mcp
```

快速检查：

```bash
curl -X POST http://localhost:8022/mcp/ \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'
```

预期能看到 `sandbox_execute_code`、`sandbox_file_operations` 等工具。

## 启动 XiaoPaw

```bash
cd learn_langchain
bun run src/xiaopaw/main.ts --config ./config.yaml
```

也可以通过环境变量指定配置：

```bash
XIAOPAW_CONFIG=./config.yaml bun run src/xiaopaw/main.ts
```

启动后：

- 飞书 WebSocket 开始监听；
- Metrics: `http://127.0.0.1:9100/metrics`；
- TestAPI: `http://127.0.0.1:9090/api/test/message`，仅在 `debug.enable_test_api: true` 时启用；
- Session: `data/sessions/`；
- Workspace: `data/workspace/`；
- Agent trace: `data/traces/`。

Ctrl+C 或 SIGTERM 会尽量停止 CronService、Runner、metrics server 和 TestAPI。

## 本地调试 TestAPI

在 `config.yaml` 中启用：

```yaml
debug:
  enable_test_api: true
```

发送测试消息：

```bash
curl --max-time 360 -X POST http://127.0.0.1:9090/api/test/message \
  -H "Content-Type: application/json" \
  -d '{"routing_key":"p2p:ou_debug","content":"你好，小爪子","sender_id":"ou_debug"}'
```

响应示例：

```json
{
  "msg_id": "test_xxx",
  "reply": "你好，我是 XiaoPaw。",
  "session_id": "s-xxxx",
  "duration_ms": 1234,
  "skills_called": []
}
```

清空 TestAPI session 数据：

```bash
curl -X DELETE http://127.0.0.1:9090/api/test/sessions
```

注意：TestAPI 适合测试普通 Agent 消息和附件注入，不适合测试 slash 命令。slash 命令走 `sendText`，而 TestAPI 的 `CaptureSender` 主要捕获 Agent 最终回复，测试 `/status` 这类命令可能等待超时。

## 飞书消息流程

```text
用户发送飞书消息
  -> FeishuListener 标准化为 InboundMessage
  -> Runner 按 routingKey 入队
  -> slash 命令？直接处理
  -> 有附件？FeishuDownloader 下载到 workspace/uploads
  -> SessionManager 加载历史
  -> FeishuSender.sendThinking() 发送“思考中”卡片
  -> Main Agent 通过 skill_loader 完成任务
  -> FeishuSender.updateCard() 更新卡片
  -> SessionManager.append() 记录 user / assistant
```

## Slash 命令

| 命令 | 功能 |
| --- | --- |
| `/new` | 创建新会话，旧历史不带入 |
| `/verbose on` | 开启详细模式，推送 Agent stream 事件 |
| `/verbose off` | 关闭详细模式 |
| `/verbose` | 查询当前详细模式状态 |
| `/status` | 查看当前会话 ID、消息数和详细模式状态 |
| `/help` | 显示命令帮助 |

## 定时任务

CronService 读取：

```text
data/cron/tasks.json
```

任务通过构造 `InboundMessage` 注入 Runner，因此和真实用户消息共用同一套 Agent、Session、Skill、Sender 链路。

支持三类调度：

| 类型 | 字段 | 说明 |
| --- | --- | --- |
| `at` | `schedule.at_ms` | 指定毫秒时间戳执行一次 |
| `every` | `schedule.every_ms` | 固定间隔执行 |
| `cron` | `schedule.expr` | 标准 cron 表达式 |

最小一次性任务示例：

```json
{
  "version": 1,
  "jobs": [
    {
      "id": "smoke-at-001",
      "name": "smoke at",
      "enabled": true,
      "schedule": {
        "kind": "at",
        "at_ms": 1782200000000,
        "every_ms": null,
        "expr": null,
        "tz": null
      },
      "payload": {
        "routing_key": "p2p:<open_id>",
        "message": "这是 CronService 冒烟测试，请回复 cron ok"
      },
      "state": {
        "next_run_at_ms": 1782200000000,
        "last_run_at_ms": null,
        "last_status": null,
        "last_error": null
      },
      "created_at_ms": 1782199990000,
      "updated_at_ms": 1782199990000,
      "delete_after_run": true
    }
  ]
}
```

`routing_key` 必须是可发送的真实目标：

- 单聊：`p2p:<open_id>`
- 群聊：`group:<chat_id>`
- 话题：`thread:<message_id>`

## Metrics

访问：

```bash
curl -i http://127.0.0.1:9100/metrics
```

核心指标：

| 指标 | 说明 |
| --- | --- |
| `xiaopaw_feishu_events_total` | 收到的飞书 WebSocket 事件 |
| `xiaopaw_inbound_messages_total` | 进入 Runner 的标准化消息 |
| `xiaopaw_runner_workers_active` | routingKey worker 活跃状态 |
| `xiaopaw_runner_queue_size` | routingKey 队列长度 |
| `xiaopaw_http_requests_total` | TestAPI 和 metrics HTTP 请求数 |
| `xiaopaw_http_request_duration_seconds` | HTTP 请求耗时 |
| `xiaopaw_errors_total` | 组件错误计数 |

一个刚启动的进程如果只访问过 `/metrics`，只看到 `xiaopaw_http_requests_total` 和 HTTP duration 是正常现象。

## 运行测试

```bash
cd learn_langchain
bun run check
bun test
```

单独运行 XiaoPaw 相关测试：

```bash
bun test src/xiaopaw
```

运行迁移验收用例请参考：

```text
docs/xiaopaw-typescript-test-cases.md
```

当前第 16 阶段完成时的基线：

```text
bun run check 通过
bun test 全量 137 pass / 0 fail
```

## 学习路线

建议按真实运行链路阅读代码：

1. `feishu/listener.ts`：飞书事件如何变成 `InboundMessage`。
2. `feishu/session-key.ts`：单聊、群聊、话题如何生成 routingKey。
3. `runner.ts`：per-routingKey 串行队列、slash 命令、附件、Agent 调用。
4. `session/manager.ts`：`index.json` 和 `s-*.jsonl` 如何维护会话。
5. `agents/main-agent.ts`：LangChain Main Agent 如何生成 structured reply。
6. `src/tools/skill-loader-tool.ts`：Skill 渐进式披露和 reference/task 分流。
7. `src/tools/skill-loader/task-runner.ts`：Sub-Agent 如何连接 AIO-Sandbox MCP tools。
8. `cleanup/service.ts`：凭证如何写入 `data/workspace/.config`。
9. `cron/service.ts`：定时任务如何通过 Runner 复用正常消息链路。
10. `observability/metrics.ts`：运行态指标如何聚合和导出。

## 学习检查清单

- [ ] 为什么同一 routingKey 要串行处理？
- [ ] 为什么 Main Agent 只暴露 `skill_loader` 一个工具？
- [ ] reference 型 Skill 和 task 型 Skill 的执行差异是什么？
- [ ] 为什么凭证不能写入 Agent prompt？
- [ ] TestAPI 的 `CaptureSender` 解决了什么调试问题？
- [ ] CronService 为什么要构造 `InboundMessage`，而不是单独调用 Agent？
- [ ] 为什么附件在 prompt 中使用 `/workspace/sessions/<session_id>/uploads/...` 路径？
