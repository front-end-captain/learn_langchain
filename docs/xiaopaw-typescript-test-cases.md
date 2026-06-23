# XiaoPaw TypeScript 测试用例

本文档描述在以下前提已经满足时，如何对 `learn_langchain` 中的 XiaoPaw TypeScript 版本做功能测试：

- 飞书客户端已打开，Bot 所在单聊或群聊可用；
- AIO-Sandbox 容器已启动；
- XiaoPaw 项目已启动；
- `config.yaml` 中已启用或明确关闭 TestAPI；
- `QWEN_API_KEY` 或 `DASHSCOPE_API_KEY` 已配置。

本文档不重复安装、启动容器、启动项目的步骤，只覆盖“服务已经运行后如何验收”。

## 1. 端口和路径约定

默认约定如下，如本地配置不同，以 `learn_langchain/config.yaml` 为准。

| 服务 | 默认地址 | 用途 |
| --- | --- | --- |
| XiaoPaw TestAPI | `http://127.0.0.1:9090` | 本地注入测试消息 |
| Metrics | `http://127.0.0.1:9100/metrics` | Prometheus 指标 |
| AIO-Sandbox MCP | `http://localhost:8022/mcp` | Sandbox 工具服务 |
| 数据目录 | `learn_langchain/data` | sessions、workspace、cron、traces |

建议测试前开两个终端：

```bash
cd learn_langchain
```

一个终端保留项目日志，另一个终端执行本文档中的 `curl` 和文件检查命令。

## 2. 测试总览

从第一性原理看，XiaoPaw 的验收不是“进程活着”这么简单，而是验证完整消息流：

```text
飞书 / TestAPI
  -> InboundMessage
  -> Runner 队列
  -> Session 历史
  -> Main Agent
  -> SkillLoader / Sandbox
  -> Sender 回复
  -> Metrics / traces / workspace
```

建议按以下顺序测试：

1. 基础健康检查：metrics、sandbox、TestAPI。
2. 本地消息闭环：TestAPI 注入普通消息。
3. 飞书真实消息闭环：单聊、群聊、话题。
4. 会话和命令：`/status`、`/new`、`/verbose`。
5. Skill / Sandbox：触发一个会写 workspace 文件的任务。
6. 附件：通过 TestAPI 或飞书发送附件。
7. 定时任务：写入 `data/cron/tasks.json` 验证 CronService。
8. 可观测性：metrics、session、trace 文件。

## 3. 基础健康检查

### TC-01 Metrics 可访问

目的：确认 XiaoPaw 主进程的 metrics server 已启动。

操作：

```bash
curl -i http://127.0.0.1:9100/metrics
```

预期：

- HTTP 状态码为 `200`；
- 响应头包含 `Content-Type: text/plain`；
- 响应体至少包含以下指标之一：
  - `xiaopaw_http_requests_total`
  - `xiaopaw_runner_queue_size`
  - `xiaopaw_errors_total`

失败排查：

- 如果连接失败，先确认项目主进程是否仍在运行；
- 如果端口不同，检查 `src/xiaopaw/main.ts` 当前固定 metrics 端口为 `9100`；
- 如果端口被占用，主进程日志通常会在启动时直接报错。

### TC-02 Sandbox MCP tools/list 可访问

目的：确认 AIO-Sandbox 容器可被 XiaoPaw 访问。

操作：

```bash
curl -X POST http://localhost:8022/mcp/ \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'
```

预期：

- HTTP 状态码为 `200`；
- 响应中能看到工具列表；
- 至少应包含类似 `sandbox_execute_code`、`sandbox_file_operations` 的工具。

失败排查：

- 检查 Docker 容器是否在运行；
- 检查 `sandbox-docker-compose.yaml` 是否把 `./src/skills` 挂载到 `/mnt/skills`，把 `./data/workspace` 挂载到 `/workspace`；
- 检查 `config.yaml` 中 `sandbox.url` 是否为 `http://localhost:8022/mcp`。

### TC-03 TestAPI 可注入普通消息

目的：确认本地调试入口能走 Runner、Session、Agent 回复链路。

前提：

- `config.yaml` 中 `debug.enable_test_api: true`；
- 项目启动日志中应显示 TestAPI 地址。

操作：

```bash
curl --max-time 360 -X POST http://127.0.0.1:9090/api/test/message \
  -H "Content-Type: application/json" \
  -d '{"routing_key":"p2p:ou_debug","content":"你好，小爪子。请用一句话回复当前系统是否正常。","sender_id":"ou_debug"}'
```

预期：

- HTTP 状态码为 `200`；
- 返回 JSON 中包含：
  - `msg_id`
  - `reply`
  - `session_id`
  - `duration_ms`
- `reply` 是自然语言回复，不应是空字符串。

注意：

- 不建议用 TestAPI 测 `/help`、`/status` 等 slash 命令。当前 TestAPI 的 `CaptureSender` 捕获 Agent 最终回复，而 slash 命令走纯文本 `sendText`，可能导致 TestAPI 等待超时。slash 命令请在飞书客户端中测试。

## 4. 飞书真实消息测试

### TC-04 飞书单聊普通消息

目的：验证真实飞书 WebSocket 事件、Runner、Agent、FeishuSender 回写链路。

操作：

在飞书中给 Bot 单聊发送：

```text
你好，小爪子。请回复“单聊链路正常”，并简单说明你收到了我的消息。
```

预期：

- Bot 先发送或更新“思考中”卡片；
- 最终回复包含“单聊链路正常”或语义等价内容；
- 项目日志没有未捕获异常；
- metrics 中 `xiaopaw_feishu_events_total` 和 `xiaopaw_inbound_messages_total` 增加。

检查 metrics：

```bash
curl -s http://127.0.0.1:9100/metrics | grep 'xiaopaw_inbound_messages_total'
```

### TC-05 飞书群聊普通消息

目的：验证群聊 routingKey、allowed_chats 配置和群聊回复。

操作：

在 Bot 所在群里发送：

```text
@小爪子 请回复“群聊链路正常”，并说明当前消息来自群聊。
```

预期：

- 如果 `allowed_chats` 为空，Bot 应正常回复；
- 如果 `allowed_chats` 配置了白名单，只有当前群 `chat_id` 在白名单内才回复；
- 回复应在当前群内出现。

失败排查：

- Bot 完全不回复时，先检查 `allowed_chats`；
- 再检查飞书应用事件订阅和 WebSocket 是否正常；
- 最后检查项目日志中是否收到了 `im.message.receive_v1`。

### TC-06 飞书话题群 / thread 消息

目的：验证 `thread:` routingKey 和话题内回复。

操作：

在飞书话题群的某个话题下发送：

```text
@小爪子 请在当前话题里回复“话题链路正常”。
```

预期：

- Bot 回复应出现在当前话题上下文中；
- 不应错误回复到群主会话或另一个话题；
- 后续在同一话题继续追问时，应复用同一个 active session。

## 5. 会话和控制命令测试

以下 slash 命令建议在飞书客户端中测试。

### TC-07 查看会话状态

操作：

```text
/status
```

预期：

- Bot 返回当前对话 ID；
- 返回消息数；
- 返回详细模式状态。

### TC-08 新建会话

操作：

```text
/new
```

预期：

- Bot 返回新的 session id；
- 后续普通消息不再带入旧 session 的历史；
- `data/sessions/index.json` 中当前 routingKey 的 `active_session_id` 发生变化。

### TC-09 verbose 模式

操作：

```text
/verbose on
```

然后发送：

```text
请列出你接下来会如何处理这个请求，但最终只需要给一句总结。
```

最后关闭：

```text
/verbose off
```

预期：

- `/verbose on` 返回详细模式已开启；
- 普通消息处理过程中可能额外发送 Agent stream 事件；
- `/verbose off` 后不再发送详细过程消息。

## 6. Skill / Sandbox 测试

### TC-10 触发写文件类 Skill

目的：验证 Main Agent 能通过 SkillLoader 调用 task 型 Skill，并在 AIO-Sandbox 中写入 workspace。

操作：

通过 TestAPI 或飞书发送：

```text
请使用合适的 Skill 在当前会话的 outputs 目录中生成一个 smoke-test.txt 文件，内容写入“xiaopaw sandbox ok”，然后告诉我文件的沙盒路径。
```

如果使用 TestAPI：

```bash
curl --max-time 360 -X POST http://127.0.0.1:9090/api/test/message \
  -H "Content-Type: application/json" \
  -d '{"routing_key":"p2p:ou_skill_smoke","content":"请使用合适的 Skill 在当前会话的 outputs 目录中生成一个 smoke-test.txt 文件，内容写入 xiaopaw sandbox ok，然后告诉我文件的沙盒路径。","sender_id":"ou_debug"}'
```

预期：

- 回复中应包含类似 `/workspace/sessions/<session_id>/outputs/smoke-test.txt` 的路径；
- 宿主机应能在 `learn_langchain/data/workspace/sessions/<session_id>/outputs/` 下看到对应文件；
- 文件内容包含 `xiaopaw sandbox ok`。

检查文件：

```bash
find data/workspace/sessions -path '*outputs/smoke-test.txt' -print
```

失败排查：

- 如果 Agent 只口头回复但没有生成文件，说明 Skill 调用或 sandbox 工具调用没有成功；
- 检查 sandbox MCP tools/list；
- 检查 `data/workspace` 是否被挂载到容器 `/workspace`；
- 检查项目日志里的 SkillLoader / Sub-Agent 错误。

### TC-11 history_reader 参考型 Skill

目的：验证历史读取不启动 sandbox，而是内联读取当前 session 历史。

操作：

先连续发送两条普通消息：

```text
请记住测试关键词：alpha-history-smoke。
```

```text
请通过历史读取能力找出我刚刚让你记住的测试关键词。
```

预期：

- Bot 能回答 `alpha-history-smoke`；
- 如果 verbose 开启，能看到类似读取历史的过程；
- 不要求 sandbox 中生成文件。

## 7. 附件测试

### TC-12 TestAPI 附件注入

目的：验证附件复制到 workspace uploads 目录，并以 sandbox 路径传给 Agent。

准备一个本地文件：

```bash
mkdir -p data/test-fixtures
printf 'attachment smoke content\n' > data/test-fixtures/smoke.txt
```

操作：

```bash
curl --max-time 360 -X POST http://127.0.0.1:9090/api/test/message \
  -H "Content-Type: application/json" \
  -d '{"routing_key":"p2p:ou_attachment","content":"请读取这个附件并告诉我里面的关键词。","sender_id":"ou_debug","attachment":{"file_path":"data/test-fixtures/smoke.txt","file_name":"smoke.txt"}}'
```

预期：

- 返回 `reply` 中应提到 `attachment smoke content` 或其语义；
- 文件被复制到 `data/workspace/sessions/<session_id>/uploads/smoke.txt`；
- Agent 收到的提示中包含 `/workspace/sessions/<session_id>/uploads/smoke.txt`。

检查复制结果：

```bash
find data/workspace/sessions -path '*uploads/smoke.txt' -print
```

### TC-13 飞书真实附件

目的：验证 FeishuDownloader 下载真实飞书图片或文件。

操作：

在飞书单聊或群聊给 Bot 发送一个小文本文件或图片，并附带说明：

```text
请读取我发的附件，并概括文件内容。
```

预期：

- 项目日志中没有附件下载异常；
- `data/workspace/sessions/<session_id>/uploads/` 下出现附件文件；
- Bot 回复能基于附件内容完成任务。

失败排查：

- 如果只回复“附件下载失败”，检查飞书应用是否有读取消息资源的权限；
- 检查 `FeishuDownloader` 日志中的 `message_id` 和 `file_key`；
- 检查本地 `data/workspace` 权限。

## 8. 定时任务测试

### TC-14 CronService 一次性任务

目的：验证 `data/cron/tasks.json` 热加载、到点注入 Runner、执行后删除。

操作：

生成一个 10 秒后触发的一次性任务：

```bash
bun -e 'const fs=require("fs"); const now=Date.now(); fs.mkdirSync("data/cron",{recursive:true}); fs.writeFileSync("data/cron/tasks.json", JSON.stringify({version:1,jobs:[{id:"smoke-at-001",name:"smoke at",enabled:true,schedule:{kind:"at",at_ms:now+10000,every_ms:null,expr:null,tz:null},payload:{routing_key:"p2p:ou_cron_smoke",message:"这是 CronService 冒烟测试，请回复 cron ok"},state:{next_run_at_ms:now+10000,last_run_at_ms:null,last_status:null,last_error:null},created_at_ms:now,updated_at_ms:now,delete_after_run:true}]}, null, 2));'
```

预期：

- 约 10 秒后，Runner 收到 `isCron=true` 的消息；
- 如果 routingKey 对应真实飞书用户或群聊，Bot 会发送回复；
- `data/cron/tasks.json` 中该任务被删除，或状态更新符合预期；
- metrics 中 runner queue/worker 有变化。

注意：

- `routing_key` 必须能被 Sender 识别。真实飞书单聊一般是 `p2p:<open_id>`，群聊是 `group:<chat_id>`，话题是 `thread:<message_id>`。
- 如果只是想验证 CronService 不依赖真实飞书，优先通过单元测试；运行态 Cron 最终仍会走当前 Runner 的 sender。

## 9. 可观测性检查

### TC-15 Session 文件

操作：

```bash
find data/sessions -maxdepth 1 -type f -print
```

预期：

- 存在 `index.json`；
- 存在一个或多个 `s-*.jsonl`；
- JSONL 中包含 `meta`、`user`、`assistant` 消息记录。

### TC-16 Agent trace 文件

操作：

```bash
find data/traces -type f -name '*.jsonl' -print
```

预期：

- 处理过真实 Agent 请求后，应出现 Agent 运行日志；
- 日志中包含 run start、stream event、run end 等记录。

### TC-17 错误指标

操作：

```bash
curl -s http://127.0.0.1:9100/metrics | grep 'xiaopaw_errors_total'
```

预期：

- 正常情况下可以没有错误指标；
- 如果刚做过失败测试，应能看到按 component 和 error_type 聚合的错误计数。

## 10. 回归测试命令

以上是运行态验收。代码改动后，还需要跑自动化回归：

```bash
cd learn_langchain
bun run check
bun test
```

预期：

- `bun run check` 通过；
- `bun test` 全量通过。

当前第 16 阶段完成时的基线是：

```text
137 pass / 0 fail
```

## 11. 测试通过标准

一次完整测试可以认为通过，需要满足：

1. Metrics、Sandbox MCP、TestAPI 基础检查通过；
2. 飞书单聊至少一轮真实消息成功；
3. 如果使用群聊或话题群，群聊和话题回复位置正确；
4. 至少一个 task 型 Skill 能通过 sandbox 执行；
5. 至少一个 session 文件被正确写入；
6. 项目日志中没有持续重试或未捕获异常；
7. `bun run check` 和 `bun test` 全量通过。

## 12. 常见误判

| 现象 | 不一定代表什么 | 更可能的原因 |
| --- | --- | --- |
| TestAPI 测 `/status` 超时 | Runner 坏了 | slash 回复走 `sendText`，TestAPI 不捕获该路径 |
| 飞书群聊不回复 | Agent 坏了 | `allowed_chats` 未包含当前群 |
| Skill 只口头回复没写文件 | Sandbox 坏了 | Agent 没有选择 task 型 Skill，或任务描述不够明确 |
| metrics 没有某个指标 | 指标系统坏了 | 该事件还没发生，counter/gauge 还没被创建 |
| Cron 任务触发但没收到飞书消息 | Cron 坏了 | `routing_key` 不是可发送的真实飞书目标 |
