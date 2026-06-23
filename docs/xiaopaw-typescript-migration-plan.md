# XiaoPaw Python → TypeScript 运行链路式迁移计划

> 目标：将 `xiaopow/` Python 项目整体迁移到 `learn_langchain` 的 TypeScript / Bun / LangChain 技术栈中。  
> 迁移方式从“按模块清单迁移”调整为“按核心运行链路渐进式迁移”，每个阶段都围绕一段真实数据流展开，便于理解 XiaoPaw 的设计。

---

## 1. 核心结论

XiaoPaw 的本质不是若干独立模块，而是一条消息流：

```text
飞书原始事件
  → 标准化 InboundMessage
  → routingKey 会话归属
  → Runner 调度
  → Session 历史
  → Agent 理解
  → SkillLoader 扩展能力
  → Sub-Agent / Sandbox 执行
  → Sender 回写飞书
```

因此后续迁移应按这条运行链路渐进实现，而不是优先按目录或模块批量迁移。

每个阶段遵循：

1. 只完成当前链路上的最小闭环；
2. 每完成一个阶段就停止，等待 review 和测试；
3. 每个阶段必须明确：
   - 学习重点；
   - 实现范围；
   - 验收重点；
4. 已经提前实现的代码不回滚，但后续按新的链路阶段进行审查、补测试、补文档。

---

## 2. 必须保持的核心不变量

1. **飞书消息入口不变**：Feishu WebSocket → 标准化 `InboundMessage`。
2. **同一 routingKey 串行，不同 routingKey 并行**。
3. **Session / Cron / Workspace 数据格式尽量兼容 Python 版本**，便于迁移历史数据。
4. **主 Agent 只通过 SkillLoaderTool 扩展能力**，不要把所有工具直接暴露给主 Agent。
5. **凭证不进入 LLM 上下文**，仍写入 sandbox workspace 的 `.config/*.json`。
6. **每个阶段完成后暂停**，直到人工 review / 测试完成后再进入下一阶段。

---

## 3. 目录复用和迁移边界原则

这个原则继续保持，不因迁移阶段调整而改变。

### 3.1 目录复用原则

XiaoPaw 的 TypeScript 迁移不应把已经在 `learn_langchain` 中实现过的能力再复制一份。

边界如下：

- `src/xiaopaw/`：只放 XiaoPaw 专属宿主编排代码：飞书接入、Runner、Session、Cron、TestAPI、Cleanup、启动入口等；
- `src/tools/`：作为统一 Tool 层，复用并增强已有：
  - `skill-loader-tool.ts`
  - `skill-loader/*`
  - `intermediate-tool.ts`
  - `add-image-tool-local.ts`
  - 后续如缺失再补 `baidu-search-tool.ts`
- `src/skills/`：作为统一 Skills 资源目录，优先复用已有 Skills；缺失的 XiaoPaw Skill 再从 `xiaopow/xiaopaw/skills` 复制补齐；
- `src/llm/`：作为统一 LLM 层，复用并增强已有 `aliyun-qwen-chat-model.ts`；
- `src/helper/`：复用已有 `file-logger.ts` / `agent-stream.ts` 的 Agent 运行日志和事件提取能力；
- `src/xiaopaw/observability/`：只放 XiaoPaw 专属 metrics/server 等宿主可观测性代码。

简化为一句话：

> **宿主编排归 XiaoPaw，共通能力归 learn_langchain 共享层。**

### 3.2 Skills 迁移边界

第一阶段不迁移 Skill 脚本语言。

迁移策略：

1. 优先复用当前 `learn_langchain/src/skills` 已存在的 Skills；
2. 对 XiaoPaw 需要但当前缺失的 Skill，从 `xiaopow/xiaopaw/skills` 复制补齐；
3. `load_skills.yaml` 需要合并，不要简单覆盖；
4. `scripts/*.py` 暂时保留 Python，继续在 AIO-Sandbox 中运行；
5. 后续如确实需要纯 TypeScript Skills，再逐个替换脚本。

优先保证以下 XiaoPaw 内置 Skills 可用：

```text
pdf/
docx/
pptx/
xlsx/
feishu_ops/
scheduler_mgr/
baidu_search/
web_browse/
history_reader/
```

### 3.3 推荐目标目录

```text
learn_langchain/src/
├── xiaopaw/
│   ├── index.ts
│   ├── main.ts
│   ├── models.ts
│   ├── config.ts
│   ├── runner.ts
│   ├── agents/
│   │   ├── main-agent.ts
│   │   ├── skill-agent.ts
│   │   ├── prompts.ts
│   │   └── models.ts
│   ├── api/
│   │   ├── capture-sender.ts
│   │   ├── schemas.ts
│   │   └── test-server.ts
│   ├── cleanup/
│   │   └── service.ts
│   ├── cron/
│   │   ├── models.ts
│   │   └── service.ts
│   ├── feishu/
│   │   ├── listener.ts
│   │   ├── sender.ts
│   │   ├── downloader.ts
│   │   └── session-key.ts
│   ├── session/
│   │   ├── models.ts
│   │   └── manager.ts
│   ├── observability/
│   │   ├── metrics.ts
│   │   └── metrics-server.ts
│   └── README.md
├── llm/
│   └── aliyun-qwen-chat-model.ts       # 复用并增强
├── tools/
│   ├── skill-loader-tool.ts            # 复用并增强
│   ├── skill-loader/
│   │   ├── instructions.ts
│   │   ├── registry.ts
│   │   ├── task-runner.ts
│   │   └── types.ts
│   ├── intermediate-tool.ts
│   ├── add-image-tool-local.ts
│   └── baidu-search-tool.ts            # 如缺失再新增
├── skills/
│   └── ...                             # 复用并补齐 XiaoPaw Skills
└── helper/
    ├── file-logger.ts
    └── agent-stream.ts
```

---

## 4. 当前 TypeScript 迁移状态

当前已存在：

```text
learn_langchain/src/xiaopaw/feishu/
├── downloader.ts
├── listener.ts
├── sender.ts
├── session-key.ts
├── *.test.ts
└── README.md

learn_langchain/src/xiaopaw/models.ts
```

当前已额外完成的 P0 代码：

```text
learn_langchain/src/xiaopaw/session/models.ts
learn_langchain/src/xiaopaw/session/manager.ts
learn_langchain/src/xiaopaw/api/capture-sender.ts
learn_langchain/src/xiaopaw/runner.ts
```

这些代码不回滚。新的链路式计划会在对应阶段对它们进行：

- 代码审查；
- 行为补齐；
- 测试补齐；
- 学习说明补齐。

---

## 5. 运行链路式分阶段迁移计划

---

### 阶段 1：飞书原始事件 → 标准化 InboundMessage

#### 目标

理解飞书 SDK 原始事件如何被压缩成 XiaoPaw 内部统一消息模型。

```text
Feishu WebSocket Event
  → FeishuListener
  → extractContent()
  → extractAttachment()
  → resolveRoutingKey()
  → normalizeReceiveMessageEvent()
  → InboundMessage
```

#### 涉及文件

Python：

```text
xiaopow/xiaopaw/models.py
xiaopow/xiaopaw/feishu/listener.py
xiaopow/xiaopaw/feishu/session_key.py
```

TypeScript：

```text
src/xiaopaw/models.ts
src/xiaopaw/feishu/listener.ts
src/xiaopaw/feishu/session-key.ts
src/xiaopaw/feishu/listener.test.ts
src/xiaopaw/feishu/session-key.test.ts
```

#### 学习重点

- 为什么需要标准化 `InboundMessage`；
- `routingKey` 为什么是会话归属的核心；
- 三类 routingKey 的区别：
  - `p2p:{open_id}`
  - `group:{chat_id}`
  - `thread:{chat_id}:{thread_id}`
- 飞书 `text` / `post` 消息如何提取纯文本；
- 飞书 `image` / `file` 消息如何提取附件元信息；
- `allowedChats` 为什么只约束群聊，不约束单聊；
- `rootId` 在 thread 回复中的作用。

#### 实现范围

- 审查并确认 `resolveRoutingKey()` 行为；
- 审查并确认 `InboundMessage` / `Attachment` 类型；
- 审查并确认 `normalizeReceiveMessageEvent()`；
- 补齐测试覆盖，如 Python 行为中有 TS 未覆盖场景，则优先补测试。

#### 验收重点

- `bun test src/xiaopaw/feishu/session-key.test.ts src/xiaopaw/feishu/listener.test.ts` 通过；
- 能用测试样例说明：
  - 单聊 → `p2p:{open_id}`；
  - 普通群聊 → `group:{chat_id}`；
  - 话题群 → `thread:{chat_id}:{thread_id}`；
- text / post / image / file 场景都有测试；
- `InboundMessage` 字段含义在代码或 README 中说明清楚。

---

### 阶段 2：SenderProtocol → FeishuSender 回复链路

#### 目标

理解 XiaoPaw 如何把内部回复发送回飞书，以及为什么要抽象 `SenderProtocol`。

```text
SenderProtocol
  → FeishuSender.send()
  → FeishuSender.sendText()
  → FeishuSender.sendThinking()
  → FeishuSender.updateCard()
```

#### 涉及文件

Python：

```text
xiaopow/xiaopaw/models.py
xiaopow/xiaopaw/feishu/sender.py
```

TypeScript：

```text
src/xiaopaw/models.ts
src/xiaopaw/feishu/sender.ts
src/xiaopaw/feishu/sender.test.ts
```

#### 学习重点

- `SenderProtocol` 的作用：隔离 Runner 和真实飞书 SDK；
- p2p / group / thread 的发送 API 差异；
- 为什么 Agent 最终回复用 interactive card；
- 为什么 slash command 用 text；
- loading 交互为什么是：

```text
sendThinking()
  → 获取 cardMsgId
  → Agent 执行
  → updateCard(cardMsgId, finalReply)
```

#### 实现范围

- 审查并确认 `FeishuSender` 已迁移逻辑；
- 确认 `buildCard()` 输出 lark_md interactive card；
- 确认 thread 回复使用 `message.reply` + `reply_in_thread`；
- 确认 retry / fallback 行为与 Python 设计一致。

#### 验收重点

- `bun test src/xiaopaw/feishu/sender.test.ts` 通过；
- sender 测试覆盖：
  - p2p create；
  - group create；
  - thread reply；
  - text reply；
  - thinking card；
  - update card；
  - retry exhausted 不导致 Runner 崩溃；
- 能解释 `SenderProtocol` 如何被 `FeishuSender` 和 `CaptureSender` 同时实现。

---

### 阶段 3：附件下载 → Workspace / Sandbox Path

#### 目标

理解用户发文件后，系统如何把飞书附件下载到本地 workspace，并把 sandbox 路径交给 Agent。

```text
InboundMessage.attachment
  → FeishuDownloader.download()
  → data/workspace/sessions/{sessionId}/uploads/{fileName}
  → /workspace/sessions/{sessionId}/uploads/{fileName}
```

#### 涉及文件

Python：

```text
xiaopow/xiaopaw/feishu/downloader.py
xiaopow/xiaopaw/runner.py
```

TypeScript：

```text
src/xiaopaw/feishu/downloader.ts
src/xiaopaw/feishu/downloader.test.ts
src/xiaopaw/runner.ts
```

#### 学习重点

- 飞书附件元信息与实际文件下载的关系；
- 本地路径和 sandbox 路径为什么不同；
- 为什么 LLM / Agent 只能看到 `/workspace/...`；
- 附件下载失败时为什么不能阻断整个消息处理；
- `uploads/`、`outputs/`、`tmp/` 三类 session workspace 的职责区别。

#### 实现范围

- 审查 `FeishuDownloader.download()`；
- 审查 Runner 中附件消息改写逻辑；
- 补齐下载失败时的行为测试；
- 保持 sandbox path 格式与 Python 版本一致。

#### 验收重点

- `bun test src/xiaopaw/feishu/downloader.test.ts` 通过；
- Runner 附件场景测试通过；
- 成功下载时传给 Agent 的消息包含：
  - `/workspace/sessions/{sessionId}/uploads/{fileName}`；
  - 用户原始备注；
- 下载失败时传给 Agent 的消息包含 `[附件下载失败]`。

---

### 阶段 4：最小 Runner：InboundMessage → fake Agent → Sender

#### 目标

先不引入完整 Session / Agent / Skill，理解 Runner 的最小职责。

```text
InboundMessage
  → Runner.dispatch()
  → fakeAgentFn()
  → SenderProtocol
```

#### 涉及文件

Python：

```text
xiaopow/xiaopaw/runner.py
```

TypeScript：

```text
src/xiaopaw/runner.ts
src/xiaopaw/runner.test.ts
```

#### 学习重点

- Runner 是调度器，不是业务 Agent；
- `agentFn` 为什么通过依赖注入传入；
- `sender` 为什么通过 `SenderProtocol` 注入；
- Runner 如何把系统入口和 Agent 执行解耦。

#### 实现范围

- 审查当前 Runner 的最小消息处理路径；
- 保证可以用 fake agent 跑通一条消息；
- 不引入真实 LLM；
- 不引入真实飞书 SDK。

#### 验收重点

- fake agent 被调用；
- fake sender 收到最终回复；
- Agent 抛错时 Runner 能发送错误提示；
- 测试能说明 Runner 的输入是 `InboundMessage`，输出是 `SenderProtocol` 调用。

---

### 阶段 5：per-routingKey 串行队列

#### 目标

理解 XiaoPaw 的并发模型。

```text
routingKey A: msg1 → msg2 → msg3 串行
routingKey B: msg1 → msg2       并行于 A
```

#### 涉及文件

Python：

```text
xiaopow/xiaopaw/runner.py
```

TypeScript：

```text
src/xiaopaw/runner.ts
src/xiaopaw/runner.test.ts
```

#### 学习重点

- 为什么同一对话必须串行；
- 为什么不同对话可以并行；
- Python `asyncio.Queue` 在 TS 中如何等价实现；
- idle timeout 为什么存在；
- queue / worker 清理的竞态风险。

#### 实现范围

- 审查当前 TS Runner 的 queue 实现；
- 补齐同 routingKey 串行测试；
- 补齐不同 routingKey 并行测试；
- 确认 idle timeout 后 queue 可清理。

#### 验收重点

- 同一 routingKey 的消息执行顺序稳定；
- 不同 routingKey 的消息可以并行执行；
- idle timeout 不影响新消息重新创建 queue；
- 异常消息不会阻塞后续消息。

---

### 阶段 6：SessionManager：routingKey → active session → JSONL history

#### 目标

理解会话归属和历史持久化。

```text
routingKey
  → SessionManager.getOrCreate()
  → data/sessions/index.json
  → data/sessions/{sessionId}.jsonl
  → loadHistory()
  → append()
```

#### 涉及文件

Python：

```text
xiaopow/xiaopaw/session/models.py
xiaopow/xiaopaw/session/manager.py
```

TypeScript：

```text
src/xiaopaw/session/models.ts
src/xiaopaw/session/manager.ts
src/xiaopaw/session/manager.test.ts
```

#### 学习重点

- `routingKey` 和 `sessionId` 的区别；
- 为什么 `index.json` 存 active session；
- 为什么历史使用 JSONL；
- `/new` 为什么创建新 session，而不是删除旧历史；
- 为什么落盘字段继续保持 Python snake_case；
- 原子写入和 fsync 的意义。

#### 实现范围

- 审查当前 TS `SessionManager`；
- 保持 JSON 格式兼容 Python；
- 补齐边界测试：
  - 不存在 index；
  - active session 丢失；
  - history 截断；
  - clearAll。

#### 验收重点

- `bun test src/xiaopaw/session/manager.test.ts` 通过；
- 生成的 `index.json` 与 Python 结构兼容；
- 生成的 `{sessionId}.jsonl` 与 Python 结构兼容；
- `loadHistory(maxTurns)` 只返回最近消息；
- `message_count` 更新正确。

---

### 阶段 7：Slash Command：不进入 Agent 的控制消息

#### 目标

理解哪些消息不应该进入 Agent。

```text
InboundMessage.content startsWith "/"
  → Runner.handleSlash()
  → SenderProtocol.sendText()
```

#### 涉及文件

Python：

```text
xiaopow/xiaopaw/runner.py
```

TypeScript：

```text
src/xiaopaw/runner.ts
src/xiaopaw/runner.test.ts
```

#### 学习重点

- slash command 是系统控制消息，不是用户业务请求；
- 为什么 slash command 不写入历史；
- 为什么 slash command 不进入 Agent；
- `/verbose` 如何影响后续 Agent 执行；
- `/new` 和 Session active id 的关系。

#### 实现范围

- 审查并补齐 slash command 测试；
- 支持：
  - `/new`
  - `/verbose on`
  - `/verbose off`
  - `/verbose`
  - `/status`
  - `/help`

#### 验收重点

- slash command 使用 `sendText()` 回复；
- slash command 不调用 `agentFn`；
- slash command 不写入 JSONL 历史；
- `/new` 后 active session 切换；
- `/verbose on/off` 后 session verbose 状态正确。

---

### 阶段 8：Runner 完整主链路

#### 目标

组合入口、队列、Session、附件、Agent、Sender，形成无真实 LLM 的完整主链路。

```text
InboundMessage
  → dispatch queue
  → slash command?
  → SessionManager.getOrCreate()
  → attachment download?
  → loadHistory()
  → sendThinking()
  → fake agentFn()
  → append history
  → updateCard() / send()
```

#### 涉及文件

```text
src/xiaopaw/runner.ts
src/xiaopaw/session/manager.ts
src/xiaopaw/api/capture-sender.ts
src/xiaopaw/runner.test.ts
```

#### 学习重点

- Runner 如何把所有基础能力串起来；
- 为什么先发送 loading card；
- 为什么 Agent 执行后再写历史；
- `updateCard()` 失败时为什么 fallback 到 `send()`；
- Runner 为什么仍然不依赖具体 LLM。

#### 实现范围

- 审查当前已实现 Runner 完整链路；
- 补齐测试缺口；
- 保持 fake agent，不接真实 LLM。

#### 验收重点

- P0 Runner 全部测试通过；
- `bun run check` 通过；
- 普通消息能完整写入 user + assistant 历史；
- loading card 更新成功；
- update card 失败时 fallback 成功；
- 附件消息进入 Agent 前被改写为 sandbox path 提示。

---

### 阶段 9：TestAPI / CaptureSender 本地调试链路

#### 目标

理解如何脱离真实飞书做本地调试。

```text
HTTP POST /api/test/message
  → InboundMessage
  → Runner.dispatch()
  → CaptureSender
  → HTTP response
```

#### 涉及文件

Python：

```text
xiaopaw/xiaopaw/api/capture_sender.py
xiaopaw/xiaopaw/api/schemas.py
xiaopaw/xiaopaw/api/test_server.py
```

TypeScript：

```text
src/xiaopaw/api/capture-sender.ts
src/xiaopaw/api/schemas.ts
src/xiaopaw/api/test-server.ts
```

#### 学习重点

- `CaptureSender` 为什么实现 `SenderProtocol`；
- 如何把异步飞书回复变成同步 HTTP 响应；
- TestAPI 为什么是本地调试入口；
- attachment.filePath 如何模拟飞书文件上传。

#### 实现范围

- 保留并审查当前 `CaptureSender`；
- 新增 `schemas.ts`；
- 用 `Bun.serve()` 实现 TestAPI；
- 支持：
  - `POST /api/test/message`
  - `DELETE /api/test/sessions`

#### 验收重点

- `POST /api/test/message` 能拿到 fake agent 回复；
- 返回包含：
  - `msg_id`
  - `reply`
  - `session_id`
  - `duration_ms`
  - `skills_called`
- `DELETE /api/test/sessions` 能清空会话；
- attachment.filePath 能复制到 workspace uploads；
- 不使用 express。

---

### 阶段 10：配置加载与 Cleanup / Credentials

#### 目标

理解运行时配置、工作区初始化、凭证隔离。

```text
config.yaml
  → config.ts
  → CleanupService.ensureWorkspaceDirs()
  → write_feishu_credentials()
  → write_baidu_credentials()
  → data/workspace/.config/*.json
```

#### 涉及文件

Python：

```text
xiaopow/config.yaml.template
xiaopow/xiaopaw/main.py
xiaopow/xiaopaw/cleanup/service.py
```

TypeScript：

```text
src/xiaopaw/config.ts
src/xiaopaw/cleanup/service.ts
```

#### 学习重点

- 为什么凭证不能进 prompt / backstory / task input；
- 为什么凭证写入 sandbox workspace `.config`；
- 为什么 `.config` 目录和凭证文件需要权限控制；
- 清理策略如何防止磁盘无限增长；
- config.yaml 与环境变量的关系。

#### 实现范围

- 新增 `config.ts`，支持 YAML 加载和 `${ENV}` 展开；
- 新增 / 迁移 `CleanupService`；
- 实现：
  - `sweep()`
  - `ensureWorkspaceDirs(sessionId)`
  - `writeFeishuCredentials()`
  - `writeBaiduCredentials()`

#### 验收重点

- config 能读取 `config.yaml`；
- `${FEISHU_APP_ID}` 等环境变量能展开；
- `.config/feishu.json` 和 `.config/baidu.json` 写入正确；
- 文件权限尽量对齐 Python：目录 `0700`，文件 `0600`；
- sweep 能按规则清理过期文件。

---

### 阶段 11：主 Agent：Runner → LangChain Agent → structured reply

#### 目标

引入真实 LLM，但暂时不引入复杂 Skills，先理解主 Agent 如何替代 Python CrewAI Main Crew。

```text
Runner
  → agentFn(userMessage, history, sessionId, routingKey, rootId, verbose)
  → LangChain Agent
  → responseFormat / structuredResponse
  → reply
```

#### 涉及文件

Python：

```text
xiaopow/xiaopaw/agents/main_crew.py
xiaopow/xiaopaw/agents/models.py
xiaopow/xiaopaw/agents/config/agents.yaml
xiaopow/xiaopaw/agents/config/tasks.yaml
xiaopow/xiaopaw/llm/aliyun_llm.py
```

TypeScript：

```text
src/xiaopaw/agents/main-agent.ts
src/xiaopaw/agents/models.ts
src/llm/aliyun-qwen-chat-model.ts
src/helper/agent-stream.ts
```

#### 学习重点

- Python `build_agent_fn()` 在 TS 中如何等价实现；
- CrewAI `output_pydantic` 如何迁移为 LangChain `responseFormat`；
- zod schema 如何约束结构化输出；
- history 如何格式化注入 Agent；
- verbose 如何通过 stream events 实现；
- 为什么 Runner 不关心底层 Agent 框架。

#### 实现范围

- 增强 `src/llm/aliyun-qwen-chat-model.ts`：
  - `QWEN_API_KEY` / `DASHSCOPE_API_KEY` fallback；
  - 默认 DashScope compatible endpoint；
  - `QWEN_DEBUG_PAYLOAD`；
  - tool result 截断；
- 新增 `main-agent.ts`；
- 使用 zod schema 定义：

```ts
const MainTaskOutput = z.object({
  reply: z.string(),
  used_skills: z.array(z.string()).default([]),
});
```

#### 验收重点

- fake / mock model 场景下 Agent 能返回结构化 `reply`；
- 有真实 Qwen key 时可通过 TestAPI 跑通一条简单对话；
- history 格式化行为和 Python 设计一致；
- verbose 开启时能推送关键 stream event；
- `bun run check` 通过。

---

### 阶段 12：SkillLoader 渐进式披露

#### 目标

理解 XiaoPaw 最核心的能力扩展机制。

```text
Main Agent
  → skill_loader description 看到 skill 菜单
  → skill_loader(skillName, taskContext)
  → 读取完整 SKILL.md
  → reference: 直接返回 instructions
  → task: 启动 Sub-Agent
```

#### 涉及文件

Python：

```text
xiaopow/xiaopaw/tools/skill_loader.py
xiaopow/xiaopaw/skills/load_skills.yaml
xiaopow/xiaopaw/skills/*/SKILL.md
```

TypeScript：

```text
src/tools/skill-loader-tool.ts
src/tools/skill-loader/registry.ts
src/tools/skill-loader/instructions.ts
src/tools/skill-loader/types.ts
src/skills/load_skills.yaml
src/skills/*/SKILL.md
```

#### 学习重点

- 为什么主 Agent 不直接暴露所有工具；
- 渐进式披露如何节省上下文；
- `reference` 和 `task` 两类 Skill 的区别；
- `history_reader` 为什么可以内联处理；
- 为什么要替换 `{skill_base}` / `{session_dir}`；
- 为什么要转义 SKILL.md 中剩余 `{}`。

#### 实现范围

- 增强现有 `src/tools/skill-loader-tool.ts`；
- 增强 `SkillLoaderOptions`：
  - `sessionId`
  - `routingKey`
  - `historyAll`
  - `workspaceRoot`
  - `sessionDir`
  - `sandboxMcpUrl`
  - `sandboxSkillsMount`
- 增强 registry description，显示当前 session workspace；
- 增强 instructions path replacement；
- 实现 `history_reader` 内联分页；
- 保持课程示例不传 XiaoPaw options 时行为兼容。

#### 验收重点

- `skill_loader` description 中能看到 enabled Skills 菜单；
- description 中能看到当前 session workspace；
- reference skill 返回 `<skill_instructions>`；
- task skill 在无 taskContext 时返回建设性提示；
- `history_reader` 能分页返回历史；
- 现有课程示例 SkillLoader 测试不被破坏。

---

### 阶段 13：Sub-Agent + AIO-Sandbox MCP

#### 目标

理解任务型 Skill 如何隔离执行。

```text
SkillLoader task skill
  → task-runner / skill-agent
  → MCP Sandbox tools
  → /workspace/sessions/{sessionId}
  → result
```

#### 涉及文件

Python：

```text
xiaopow/xiaopaw/agents/skill_crew.py
xiaopow/xiaopaw/agents/config/agents.yaml
xiaopow/xiaopaw/agents/config/tasks.yaml
```

TypeScript：

```text
src/tools/skill-loader/task-runner.ts
src/xiaopaw/agents/skill-agent.ts        # 如需要再新增
src/skills/*/SKILL.md
```

#### 学习重点

- 为什么 Sub-Agent 每次新建；
- 为什么 Sub-Agent 不继承 Main Agent 的完整历史；
- 为什么具体文件操作必须在 sandbox 中执行；
- MCP tools 如何被 LangChain Agent 使用；
- sandbox path 和凭证隔离如何共同保证安全边界。

#### 实现范围

- 增强 `task-runner.ts`；
- 接入 `@langchain/mcp-adapters`；
- 对齐 Python `skill_agent` prompt 约束；
- 支持 browser_* / sandbox_convert_to_markdown 等工具说明；
- 支持 `subAgentModel`、`maxIter` 等配置。

#### 验收重点

- 启动 AIO-Sandbox 后，task skill 能调用 MCP tools；
- 能读取 `/mnt/skills/{skillName}`；
- 能读写 `/workspace/sessions/{sessionId}/outputs/`；
- Sub-Agent 结果能返回 Main Agent；
- 不把 sessionId / credentials 暴露给 Main Agent prompt 中不该出现的位置。

#### 执行记录（2026-06-23）

当前第 13 阶段已补齐 TypeScript 侧基础实现与单元测试：

- `src/tools/skill-loader/task-runner.ts`
  - 保留 `@langchain/mcp-adapters` 接入 AIO-Sandbox MCP；
  - 抽出 Sub-Agent system prompt / task prompt 构建逻辑；
  - 对齐 Python `skill_agent` 的沙盒路径、工具约束、stdout JSON 返回、browser_* 工具等关键行为规范；
  - 支持 `subAgentModel`、`subAgentMaxIter`、`mcpToolsProvider`、`subAgentRunner`、`subAgentChatModel` 注入，便于真实运行和无 sandbox 单元测试；
  - 默认 MCP client 在单次 Sub-Agent 执行结束后关闭，避免长期运行中积累连接；
  - 默认 Sub-Agent runner 使用 LangChain `createAgent()`，并通过 `recursionLimit` 约束最大迭代。
- `src/tools/skill-loader/types.ts`
  - 补齐第 13 阶段所需的 SkillLoader options 与 LangChain tool 类型。
- `src/xiaopaw/agents/main-agent.ts`
  - 将 `subAgentModel` / `subAgentMaxIter` 从主 Agent 构建参数继续透传给 SkillLoader。
- `src/tools/skill-loader/task-runner.test.ts`
  - 新增第 13 阶段针对性测试，覆盖 prompt 边界、MCP URL 传递、session workspace 路径、maxIter 传递和默认 runner 返回结果。

已验证：

```bash
cd learn_langchain
bun run check
bun test src/tools/skill-loader/task-runner.test.ts src/tools/skill-loader-tool.test.ts src/xiaopaw/agents/main-agent.test.ts
bun test
```

结果：`bun run check` 通过，`bun test` 全量 117 个测试通过。

真实 AIO-Sandbox 最小冒烟已通过：

- `learn_langchain/sandbox-docker-compose.yaml` 挂载对齐为：
  - `./src/skills:/mnt/skills:ro`
  - `./data/workspace:/workspace:rw`
  - `./data/cron:/workspace/cron:rw`
- MCP 端点返回 31 个工具，包含 `sandbox_execute_code`、`sandbox_file_operations`、`sandbox_convert_to_markdown` 和 `browser_*`；
- sandbox 内 `/workspace`、`/workspace/sessions`、`/workspace/cron` 均可写，`/mnt/skills` 只读；
- 通过 `runTaskSkill()` 获取真实 MCP tools，并用 `sandbox_execute_code` 成功写入和读回：
  - `/workspace/sessions/stage13-smoke/outputs/stage13-smoke.txt`
  - 宿主路径：`learn_langchain/data/workspace/sessions/stage13-smoke/outputs/stage13-smoke.txt`

第 13 阶段可以视为完成，下一步进入第 14 阶段前可做人工 review。

---

### 阶段 14：CronService：定时任务注入 Runner

#### 目标

理解定时任务如何复用正常消息处理链路，而不是另起一套执行系统。

```text
data/cron/tasks.json
  → CronService
  → fake InboundMessage(isCron=true)
  → Runner.dispatch()
```

#### 涉及文件

Python：

```text
xiaopow/xiaopaw/cron/models.py
xiaopow/xiaopaw/cron/service.py
xiaopaw/xiaopaw/skills/scheduler_mgr/
```

TypeScript：

```text
src/xiaopaw/cron/models.ts
src/xiaopaw/cron/service.ts
src/skills/scheduler_mgr/
```

#### 学习重点

- 为什么 CronService 构造 fake InboundMessage；
- `at` / `every` / `cron` 三种 schedule 的区别；
- tasks.json 为什么需要热加载；
- scheduler_mgr Skill 和 CronService 的职责边界。

#### 实现范围

- 新增 cron models；
- 新增 CronService；
- 使用 `cron-parser`；
- 保持 tasks.json 格式兼容 Python；
- 支持 mtime + size 热重载。

#### 验收重点

- at 任务能触发一次；
- every 任务能重复触发；
- cron 表达式能计算下一次；
- disabled job 不触发但持久化保留；
- 触发后进入 Runner，而不是直接调用 Agent。

#### 执行记录（2026-06-23）

当前第 14 阶段已补齐 TypeScript 侧基础实现与单元测试：

- 新增依赖：
  - `cron-parser@5.6.0`，用于计算 `cron` 表达式下一次触发时间。
- `src/xiaopaw/cron/models.ts`
  - 定义 `CronSchedule` / `CronPayload` / `CronState` / `CronJob` / `CronStore`；
  - 使用 zod 解析 `tasks.json`，保持 Python 版本 snake_case 字段兼容。
- `src/xiaopaw/cron/service.ts`
  - 实现 `CronService` 生命周期：`start()` / `stop()` / `tick()`；
  - 从 `data/cron/tasks.json` 加载 enabled jobs，disabled jobs 不调度但原样保留；
  - 支持 `at` / `every` / `cron` 三种 schedule；
  - `cron` 任务每次加载时用 `cron-parser` 重新计算 `state.next_run_at_ms`；
  - 支持 mtime + size 热重载；
  - 触发时构造 `InboundMessage`，字段包含 `senderId="cron"`、`isCron=true`，并调用注入的 `dispatchFn`；
  - 触发后写回 `state.last_run_at_ms`、`last_status`、`last_error`，`at` 任务按 `delete_after_run` 删除或禁用，`every` / `cron` 任务重新计算下次触发。
- `src/xiaopaw/cron/service.test.ts`
  - 覆盖 at 触发、at 删除、every 重排、cron next 计算、disabled 持久化保留、热重载、dispatch 错误状态记录、start/stop tick loop。
- `src/xiaopaw/cron/index.ts` 和 `src/xiaopaw/index.ts`
  - 导出 CronService 相关模块，供后续主入口接入 Runner。

已验证：

```bash
cd learn_langchain
bun test src/xiaopaw/cron/service.test.ts
bun run check
bun test
```

结果：`bun run check` 通过，`bun test` 全量 125 个测试通过。

第 14 阶段可以视为完成。下一步进入第 15 阶段前，可在后续主入口实现时把 `new CronService({ dispatchFn: runner.dispatch.bind(runner) })` 接入启动流程。

---

### 阶段 15：Observability：日志、指标、Agent 事件

#### 目标

理解 XiaoPaw 如何观察运行状态。

```text
Runner / Listener / TestAPI / Agent
  → logger
  → metrics
  → file-logger / agent-stream
  → /metrics
```

#### 涉及文件

Python：

```text
xiaopow/xiaopaw/observability/logging_config.py
xiaopow/xiaopaw/observability/metrics.py
xiaopow/xiaopaw/observability/metrics_server.py
```

TypeScript：

```text
src/xiaopaw/observability/metrics.ts
src/xiaopaw/observability/metrics-server.ts
src/helper/file-logger.ts
src/helper/agent-stream.ts
```

#### 学习重点

- 业务日志、Agent 运行日志、Prometheus metrics 的区别；
- 为什么 metrics 要按 component / routingKeyType 分类；
- verbose 事件和 file-logger 的关系；
- TestAPI / metrics endpoint 如何帮助本地调试。

#### 实现范围

- 复用 `file-logger.ts` 记录 Agent 运行事件；
- 复用 / 增强 `agent-stream.ts` 提取 Agent 事件；
- 新增 XiaoPaw metrics 定义；
- 新增 `/metrics` server。

#### 验收重点

- `/metrics` 能输出 Prometheus 格式；
- Feishu event / inbound message / runner queue / errors 指标可记录；
- Agent 运行事件能写入文件；
- 不因 observability 失败中断主链路。

#### 执行记录（2026-06-23）

当前第 15 阶段已补齐 TypeScript 侧基础实现与单元测试：

- `src/xiaopaw/observability/metrics.ts`
  - 新增轻量 Prometheus registry，支持 counter / gauge / histogram 文本导出；
  - 指标包括：
    - `xiaopaw_feishu_events_total`
    - `xiaopaw_inbound_messages_total`
    - `xiaopaw_runner_workers_active`
    - `xiaopaw_runner_queue_size`
    - `xiaopaw_http_requests_total`
    - `xiaopaw_http_request_duration_seconds`
    - `xiaopaw_errors_total`
  - 提供 `routingKeyType()`，按 `p2p` / `group` / `thread` / `unknown` 分类。
- `src/xiaopaw/observability/metrics-server.ts`
  - 新增 Bun 版 `/metrics` server；
  - `GET /metrics` 输出 Prometheus text format；
  - `/metrics` 自身也记录 HTTP 请求指标。
- `src/xiaopaw/runner.ts`
  - 新增可选 `metrics` 注入；
  - 记录 per-routingKey worker active、queue size 和 runner/sender error；
  - metrics hook 抛错不会中断消息处理。
- `src/xiaopaw/api/test-server.ts`
  - 新增可选 HTTP metrics 注入；
  - 记录 TestAPI path / method / status / duration；
  - metrics hook 抛错不会影响 HTTP 响应。
- `src/xiaopaw/agents/main-agent.ts`
  - 复用 `file-logger.ts` 和 `agent-stream.ts`；
  - 支持 `agentLogDir` / `agentLogFormat`，将 Agent stream events 写入 JSONL；
  - verbose 事件继续通过 sender 发送，文件日志作为独立观测通道。
- `src/xiaopaw/observability/index.ts` 和 `src/xiaopaw/index.ts`
  - 导出 observability 模块，供后续 `main.ts` 组合进程使用。
- 测试覆盖：
  - `src/xiaopaw/observability/metrics.test.ts`
  - `src/xiaopaw/runner.test.ts`
  - `src/xiaopaw/api/test-server.test.ts`
  - `src/xiaopaw/agents/main-agent.test.ts`

已验证：

```bash
cd learn_langchain
bun test src/xiaopaw/observability/metrics.test.ts src/xiaopaw/runner.test.ts src/xiaopaw/api/test-server.test.ts src/xiaopaw/agents/main-agent.test.ts
bun run check
bun test
```

结果：`bun run check` 通过，`bun test` 全量 133 个测试通过。

第 15 阶段可以视为完成。下一步进入第 16 阶段：`main.ts` 组合完整 XiaoPaw 进程。

---

### 阶段 16：main.ts：组合完整 XiaoPaw 进程

#### 目标

把所有阶段串成可启动的 XiaoPaw TypeScript 服务。

```text
main.ts
  → load config
  → setup logging / metrics
  → SessionManager
  → CleanupService
  → FeishuSender / Downloader
  → agentFn
  → Runner
  → CronService
  → FeishuListener
  → optional TestAPI
```

#### 涉及文件

Python：

```text
xiaopow/xiaopaw/main.py
xiaopow/config.yaml.template
```

TypeScript：

```text
src/xiaopaw/main.ts
src/xiaopaw/config.ts
src/xiaopaw/README.md
learn_langchain/README.md
```

#### 学习重点

- 进程启动顺序为什么重要；
- 为什么先写凭证再启动 Agent / Skills；
- 为什么 Listener、Cron、Metrics、TestAPI 是并行服务；
- 如何优雅 shutdown；
- 本地调试和生产飞书接入的差异。

#### 实现范围

- 新增 `src/xiaopaw/main.ts`；
- 不新增 package script；
- 在 README 中说明启动方式：

```bash
cd learn_langchain
bun run src/xiaopaw/main.ts
```

- 说明如何启动 sandbox；
- 说明如何启用 TestAPI；
- 说明必要环境变量。

#### 验收重点

- `bun run src/xiaopaw/main.ts` 能启动；
- 配置缺失时给出明确错误；
- debug TestAPI 可用；
- metrics endpoint 可用；
- 真实 Feishu Listener 可启动；
- Ctrl+C / SIGTERM 能尽量释放资源。

#### 执行记录（2026-06-23）

- 新增 `src/xiaopaw/main.ts`，组合配置加载、凭证落盘、SessionManager、CleanupService、FeishuSender/Downloader、Runner、CronService、FeishuListener、metrics server 和可选 TestAPI。
- 入口保持 `bun run src/xiaopaw/main.ts`，未新增 `package.json` script；支持 `--config <path>` 和 `XIAOPAW_CONFIG` 指定配置文件。
- 为 TestAPI 单独创建 `CaptureSender + Runner`，避免调试回复等待逻辑污染生产飞书 Sender；生产 Runner 与 TestAPI Runner 共享同一个 SessionManager。
- 启动时校验 `feishu.app_id`、`feishu.app_secret`、`QWEN_API_KEY`/`DASHSCOPE_API_KEY`，配置缺失时返回明确错误。
- Metrics endpoint 固定为 `http://127.0.0.1:9100/metrics`，沿用 Python 版端口。
- 新增 `src/xiaopaw/main.test.ts`，覆盖配置路径解析、缺配置错误、必要配置校验、metrics/TestAPI/listener 启动和 shutdown。
- 更新 `learn_langchain/README.md` 和 `src/xiaopaw/README.md`，补充 sandbox、配置样例、必要环境变量、启动命令、TestAPI 与 metrics 说明。

已验证：

```bash
cd learn_langchain
bun run check
bun test
bun run src/xiaopaw/main.ts --config /tmp/xiaopaw-missing-config.yaml
```

结果：`bun run check` 通过，`bun test` 全量 137 个测试通过；缺失配置冒烟按预期以非 0 退出，并提示配置文件路径、`--config` 和 `XIAOPAW_CONFIG`。

---

## 6. 阶段推进规则

后续执行时严格遵守：

1. 每次只推进一个阶段；
2. 阶段开始前说明：本阶段目标、涉及文件、计划修改点；
3. 阶段中不顺手实现后续阶段内容；
4. 阶段完成后运行对应测试；
5. 阶段完成后停止，等待 review 和测试；
6. 用户确认后再进入下一阶段。

---

## 7. 依赖建议

当前 `package.json` 已有：

```json
{
  "@langchain/core": "^1.1.48",
  "@langchain/mcp-adapters": "^1.1.3",
  "@langchain/openai": "^1.4.7",
  "@larksuiteoapi/node-sdk": "^1.67.0",
  "@modelcontextprotocol/sdk": "^1.29.0",
  "langchain": "^1.4.4",
  "pino": "^10.3.1"
}
```

建议按阶段需要逐步新增，不一次性安装：

```bash
cd learn_langchain
bun add zod yaml cron-parser prom-client mime
```

用途：

- `zod`：TestAPI schemas、Agent structured output、Tool input schema；
- `yaml`：配置文件与 Skills manifest 解析；
- `cron-parser`：CronService 计算下一次触发时间；
- `prom-client`：Prometheus metrics；
- `mime`：文件上传/下载、图片 data URL、Skill 输出文件类型识别。

---

## 8. 关键风险点

### 风险 1：学习阶段和实现状态不完全一致

当前已经提前实现了部分 Runner / Session / CaptureSender。新的阶段顺序不要求回滚，而是在对应阶段进行审查和补齐。

### 风险 2：CrewAI → LangChain 不是一一等价

Python 版依赖 CrewAI 的：

- `Agent`
- `Task`
- `Crew`
- `Process.sequential`
- `output_pydantic`
- `step_callback`
- `BaseTool`
- `MCPServerHTTP`

TS 版需要用 LangChain 重构，不是简单翻译。

应对：

- 固定 `AgentFn` 接口；
- Runner 不关心底层是 CrewAI 还是 LangChain；
- Agent 层内部逐步替换。

### 风险 3：verbose 模式难以完全还原

CrewAI 可以拿到 `AgentAction.thought`，LangChain 未必暴露同样粒度。

应对：

- 保留 `/verbose` 命令和状态；
- 通过 stream events 推送用户可理解的运行进度；
- 不为了还原 Thought 引入不稳定 hack。

### 风险 4：Skills 路径和 sandbox mount 必须保持一致

Python 版假设：

```text
Skill 资源挂载：/mnt/skills/{skillName}
Session 工作区：/workspace/sessions/{sessionId}
```

TS 版必须继续生成同样路径，否则 SKILL.md 和脚本都会失效。

### 风险 5：数据格式兼容

如果 TS 版把 JSON 字段改成 camelCase，会破坏现有：

- `data/sessions/index.json`
- `data/sessions/*.jsonl`
- `data/cron/tasks.json`

应对：

- TS 内部可用 camelCase；
- 落盘继续用 Python snake_case；
- 读旧数据时兼容 snake_case。

### 风险 6：Qwen API base

现有 TS `AliyunQwenChatModel` 要求 `apiBase` 必填，而 Python 默认内置 DashScope endpoint。迁移 XiaoPaw 时需要补默认值，否则用户只配 `QWEN_API_KEY` 会失败。
