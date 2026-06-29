# 第2课：解构智能体——Agent 的解剖学与 ReAct 范式

本课从零构建一个 Agent，理解 ReAct 循环的本质，然后用 LangChain 框架实现同样的功能。

> **核心教学点**：Agent 三要素（Role/Goal/Backstory）、ReAct 循环（Thought→Action→Observation→Final Answer）、手写 Agent vs 框架 Agent 的对比

---

## 目录结构

```
lesson6/
├── raw-agent.ts                  # TypeScript 手写 ReAct Agent（不用 Agent 框架）
├── raw-ink.tsx                   # 手写版命令行入口
├── raw-agent-system-prompt.txt   # 手写版系统提示词模板
├── raw-agent-user-prompt.txt     # 手写版用户提示词模板
├── agent.ts                      # LangChain createAgent 框架版
├── ink.tsx                       # LangChain 框架版命令行入口
└── 极客时间-最终报告.md           # 示例产出
```

---

## 快速开始

```bash
cd learn_langchain

# 手写 ReAct Agent（理解原理）
bun run src/course_01/lesson6/raw-ink.tsx

# LangChain createAgent（框架封装）
bun run src/course_01/lesson6/ink.tsx
```

---

## 课堂代码演示学习指南

### 整体架构一览

```
┌──────────────────────────────────────────────────────┐
│  raw-agent.ts（手写 ReAct）                           │
│                                                      │
│  system_prompt + user_prompt                         │
│       ↓                                              │
│  while True:                                         │
│    LLM.call(stop=["Observation:"])                   │
│       ↓                                              │
│    解析 Action / Action Input                         │
│       ↓                                              │
│    执行工具 → 拼接 Observation                        │
│       ↓                                              │
│    检测 Final Answer → 退出                           │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  agent.ts（LangChain createAgent 封装）               │
│                                                      │
│  createAgent({ model, tools, systemPrompt })          │
│       ↓                                              │
│       ↓                                              │
│  agent.stream({ messages })                          │
│  → LangChain 内部自动完成工具调用循环                 │
└──────────────────────────────────────────────────────┘
```

### 学习路线（建议按顺序阅读）

---

#### 第一步：理解 ReAct 提示词模板

**阅读文件**：`raw-agent-system-prompt.txt` + `raw-agent-user-prompt.txt`

| 重点 | 看什么 |
|------|--------|
| 系统提示词 | `{role}`, `{goal}`, `{backstory}` 占位符——Agent 三要素 |
| ReAct 格式 | `Thought:` → `Action:` → `Action Input:` → `Observation:` 循环 |
| 终止条件 | `Final Answer:` 标记结束 |
| 工具注入 | `{tools_map}` 和 `{tools_name}` 告诉 Agent 可用工具 |

---

#### 第二步：看手写 Agent——理解 ReAct 循环的本质

**对应课文**：第二节"ReAct 范式"

**阅读文件**：`raw-agent.ts`

| 重点区域 | 看什么 |
|---------|--------|
| `RawAgent.__init__()` | 加载 prompt 模板 + 注册工具 |
| `_generate_prompt()` | 将 Role/Goal/Backstory + 工具列表填入模板 |
| `run()` 主循环 | `while True` → 调用 LLM（`stop=["Observation:"]`） → 解析输出 |
| Action 解析 | 正则匹配 `Action:` 和 `Action Input:` |
| 工具执行 | 根据 Action 名称查表 → 调用工具 → 结果拼接为 `Observation:` |
| Final Answer 检测 | 匹配到 `Final Answer:` 就退出循环 |

**理解要点**：`stop=["Observation:"]` 是关键——让 LLM 在输出 Action 后暂停，等待外部工具执行结果。这就是 ReAct 的"交替执行"机制。

---

#### 第三步：看 LangChain Agent——框架如何封装工具调用循环

**对应课文**：第三节"框架封装"

**阅读文件**：`agent.ts`

| 重点区域 | 看什么 |
|---------|--------|
| Agent 定义 | `createAgent({ model, tools, systemPrompt })`——把模型、工具和系统提示词交给框架 |
| 工具挂载 | `tools: [baiduSearchTool, fileWriterTool, scrapeWebsiteTool]` |
| Task 输入 | `messages: [{ role: "user", content }]`——对应手写版用户提示词 |
| Agent 执行 | `agent.stream()` 自动处理模型输出、工具调用和消息历史 |

**理解要点**：LangChain 把手写版显式管理的循环、工具调用和消息拼接封装到 `createAgent` 内部。你少写了大量控制代码，但也失去了一部分对循环格式、解析方式和错误恢复策略的直接控制。

---

#### 第四步：对比两个版本

| 维度 | 手写版 | LangChain createAgent 版 |
|------|--------|----------|
| 循环控制 | 显式 `for` 循环，设置 `maxIterations` 防止无限运行 | 框架内部 |
| 工具执行 | 手动解析 `Action` / `Action Input`，再查表调用工具 | 声明式注册工具 |
| Observation | 手动拼接到 assistant 消息中 | 框架自动维护消息历史 |
| 提示词 | 模板文件显式约束 ReAct 文本格式 | 系统提示词 + 工具 schema |
| 灵活性 | 完全可控，教学价值高 | 代码更少，工程效率高 |

---

### 学习检查清单

- [ ] ReAct 的四个步骤是什么？（Thought → Action → Action Input → Observation）
- [ ] `stop=["Observation:"]` 的作用是什么？（让 LLM 暂停等待工具结果）
- [ ] Agent 的三要素是什么？（Role / Goal / Backstory）
- [ ] 手写版和框架版的核心区别是什么？（ReAct 循环的显式 vs 隐式实现）
