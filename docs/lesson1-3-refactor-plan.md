# Lesson1-3 目录化、Ink UI 与 Pino 日志改造方案

> 目标：以 lesson4 当前的实现方式为模板，改造 `lesson1`、`lesson2`、`lesson3`。
>
> 核心方向：目录化、Agent/Workflow 封装、保留 stream 版本、Ink 渲染、Pino JSONL + pretty 日志。

---

## 1. 总体改造目标

按照 lesson4 的方式，lesson1、lesson2、lesson3 不应该简单“加一个 Ink 文件”，而应该统一抽象成一套可复用范式。

核心目标是：

```text
每一课都变成：
Agent / Workflow 逻辑层
  ↓
Stream Event 事件层
  ↓
Ink UI / File Logger 消费层
```

这样 lesson1-4 的结构和使用方式就一致了。

---

## 2. 统一目录结构

把当前：

```text
src/course_01/lesson1.ts
src/course_01/lesson2.ts
src/course_01/lesson3.ts
```

改造成：

```text
src/course_01/lesson1/
├── agent.ts
└── ink.tsx

src/course_01/lesson2/
├── agent.ts
└── ink.tsx

src/course_01/lesson3/
├── workflow.ts
└── ink.tsx
```

其中：

| 文件 | 职责 |
|---|---|
| `agent.ts` | 单 Agent lesson 的模型、prompt、schema、stream 执行封装 |
| `workflow.ts` | 多 Agent / 多任务 workflow 的顺序编排封装 |
| `ink.tsx` | Ink TUI 渲染版本，也是课程运行入口 |
| `src/helper/file-logger.ts` | 通用 Pino 文件日志 |
| `src/helper/agent-stream.ts` | 可选：抽象 stream chunk → event 的公共工具 |

---

## 3. 先改 `file-logger.ts`：从 lesson4 专用改成通用

当前：

```text
src/helper/file-logger.ts
```

还绑定了 lesson4 类型：

```ts
import type {
  ImageAnalysis,
  ImageAnalysisStreamEvent,
} from "../course_01/lesson4/agent";
```

这对 lesson1-3 不合适。

应该改成通用版本，例如：

```ts
export type AgentRunStatus = "success" | "error";
export type LogFormat = "jsonl" | "pretty" | "both";

export type AgentRunFileLogger<TEvent, TResult> = {
  logFilePath: string;
  prettyLogFilePath?: string;
  writeRunStart: (input: Record<string, unknown>) => void;
  writeEvent: (event: TEvent) => void;
  writeRunEnd: (input: {
    status: AgentRunStatus;
    result?: TResult;
    error?: unknown;
  }) => void;
  close: () => void;
};
```

创建函数变成：

```ts
export function createAgentRunFileLogger<TEvent, TResult>(options: {
  logDir: string;
  runName: string;
  runId?: string;
  format?: LogFormat;
  normalizeEvent?: (event: TEvent) => Record<string, unknown>;
}): AgentRunFileLogger<TEvent, TResult>;
```

这样 lesson1-4 都能用：

```ts
const fileLogger = createAgentRunFileLogger<Lesson2StreamEvent, ContentStrategyBrief>({
  logDir: __dirname,
  runName: "lesson2",
  format: "both",
});
```

日志 message 可以根据 `runName` 生成：

```text
lesson2_run_start
lesson2_stream_event
lesson2_run_end
```

---

## 4. 抽一个公共 stream event 类型

lesson1、lesson2、lesson4 都是单 Agent stream。它们有共同事件：

```ts
export type AgentStreamEvent<TStructuredResponse = unknown> =
  | {
      type: "agent_update";
      messageType: string | undefined;
      content: unknown;
    }
  | {
      type: "tool_calls";
      toolCalls: ToolCall[];
    }
  | {
      type: "structured_response";
      structuredResponse: TStructuredResponse;
    };
```

可以放在：

```text
src/helper/agent-stream.ts
```

同时提供公共函数：

```ts
export function maskBase64ImageContent(content: unknown): unknown;
export function getToolCalls(message: unknown): ToolCall[];
export function createAgentUpdateEvent(...): AgentStreamEvent;
export function createToolCallsEvent(...): AgentStreamEvent;
```

这样 lesson4 里的这些逻辑：

```ts
maskBase64ImageContent
getToolCalls
```

就不用每课重复写。

---

## 5. lesson1 改造方案

### 5.1 当前 lesson1 本质

当前 `lesson1.ts` 是：

```text
用 createAgent 创建内容策略 Agent
  ↓
stream 执行
  ↓
console.log 每个 chunk
```

它没有结构化输出 schema，最终结果主要是最后一条 AI 消息内容。

所以 lesson1 的输出类型可以定义为：

```ts
export type Lesson1Result = {
  finalContent: unknown;
  finalMessageType: string | undefined;
};
```

### 5.2 目录

```text
src/course_01/lesson1/
├── agent.ts
└── ink.tsx
```

### 5.3 `lesson1/agent.ts`

负责导出：

```ts
export type Lesson1StreamEvent = AgentStreamEvent;

export type Lesson1Result = {
  finalContent: unknown;
  finalMessageType: string | undefined;
};

export function createContentStrategistAgent();
export function createLesson1TaskMessage(input: string): string;
export async function runLesson1WithStream(
  input: string,
  onEvent?: (event: Lesson1StreamEvent) => void,
): Promise<Lesson1Result>;
```

注意：lesson1 没有 `structured_response`，所以只需要记录：

```text
agent_update
tool_calls
```

最终返回最后一条消息内容。

### 5.4 `lesson1/ink.tsx`

Ink UI 展示：

```text
正在执行 lesson1 内容策略 Agent
输入：我今天健身了，感觉很开心，帮我设计一篇笔记
当前状态：Agent 状态更新：ai
格式化日志：xxx.pretty.log
JSONL 日志：xxx.jsonl

最终输出：
...
```

运行方式：

```sh
bun run src/course_01/lesson1/ink.tsx
```

可支持自定义输入：

```sh
bun run src/course_01/lesson1/ink.tsx "我今天健身了，感觉很开心，帮我设计一篇笔记"
```

---

## 6. lesson2 改造方案

### 6.1 当前 lesson2 本质

当前 `lesson2.ts` 是：

```text
视觉分析报告 mock 数据
  ↓
ContentStrategist Agent
  ↓
responseFormat: ContentStrategyBriefSchema
  ↓
stream 观察执行过程
  ↓
chunk.structuredResponse 获取结构化输出
```

所以 lesson2 和 lesson4 很接近，只是没有图片工具。

### 6.2 目录

```text
src/course_01/lesson2/
├── agent.ts
└── ink.tsx
```

### 6.3 `lesson2/agent.ts`

负责导出：

```ts
export const ImageAnalysisSchema;
export const VisualAnalysisReportSchema;
export const ContentStrategyBriefSchema;

export type VisualAnalysisReport;
export type ContentStrategyBrief;

export const defaultVisualReport;

export type Lesson2StreamEvent = AgentStreamEvent<ContentStrategyBrief>;

export function createContentStrategyTaskMessage(report: VisualAnalysisReport): string;
export function createContentStrategistAgent();
export async function runLesson2WithStream(
  report: VisualAnalysisReport,
  onEvent?: (event: Lesson2StreamEvent) => void,
): Promise<ContentStrategyBrief>;
```

关键逻辑：

```ts
const stream = await contentStrategist.stream(..., {
  streamMode: "values",
});

let finalBrief: ContentStrategyBrief | undefined;

for await (const chunk of stream) {
  // agent_update
  // tool_calls
  // structured_response
}
```

最终：

```ts
return ContentStrategyBriefSchema.parse(finalBrief);
```

### 6.4 `lesson2/ink.tsx`

Ink UI 展示：

```text
正在执行 lesson2 结构化内容策略任务
当前状态：正在调用工具 Save_Intermediate_Product_Tool
格式化日志：xxx.pretty.log
JSONL 日志：xxx.jsonl

最终结构化输出：
素材评估
目标受众画像
核心痛点
建议标题
笔记大纲
互动策略
收藏策略
SEO 关键词
```

运行方式：

```sh
bun run src/course_01/lesson2/ink.tsx
```

---

## 7. lesson3 改造方案

lesson3 比较特殊，因为它不是单 Agent，而是 Sequential Workflow。

### 7.1 当前 lesson3 本质

当前 lesson3 是：

```text
VisualAnalysisReport
  ↓
contentStrategist.invoke()
  ↓
ContentStrategyBrief
  ↓
contentWriter.invoke()
  ↓
CopywritingOutput
  ↓
seoOptimizer.invoke()
  ↓
SEOOptimizedNoteReport
```

如果要“同样方式”改造，重点不是简单把 `invoke` 换成 `stream`，而是要把 workflow 每一步都变成可观察事件。

### 7.2 目录

```text
src/course_01/lesson3/
├── workflow.ts
└── ink.tsx
```

### 7.3 `lesson3/workflow.ts`

导出 schema 和类型：

```ts
export const ImageAnalysisSchema;
export const VisualAnalysisReportSchema;
export const ContentStrategyBriefSchema;
export const CopywritingOutputSchema;
export const SEOOptimizedNoteReportSchema;

export type VisualAnalysisReport;
export type ContentStrategyBrief;
export type CopywritingOutput;
export type SEOOptimizedNoteReport;
```

最终工作流返回类型：

```ts
export type Lesson3WorkflowResult = {
  strategyBrief: ContentStrategyBrief;
  copywritingOutput: CopywritingOutput;
  finalReport: SEOOptimizedNoteReport;
  tasksOutput: Array<{
    taskName: string;
    outputType: string;
    structuredResponse: unknown;
  }>;
};
```

### 7.4 lesson3 的事件类型

lesson3 推荐定义更丰富的 workflow event：

```ts
export type Lesson3WorkflowStep =
  | "content_strategy"
  | "copywriting"
  | "seo_optimization";

export type Lesson3WorkflowEvent =
  | {
      type: "workflow_start";
      input: VisualAnalysisReport;
    }
  | {
      type: "step_start";
      step: Lesson3WorkflowStep;
    }
  | {
      type: "agent_update";
      step: Lesson3WorkflowStep;
      messageType: string | undefined;
      content: unknown;
    }
  | {
      type: "tool_calls";
      step: Lesson3WorkflowStep;
      toolCalls: ToolCall[];
    }
  | {
      type: "step_structured_response";
      step: Lesson3WorkflowStep;
      structuredResponse: unknown;
    }
  | {
      type: "step_end";
      step: Lesson3WorkflowStep;
      outputType: string;
    }
  | {
      type: "workflow_end";
      result: Lesson3WorkflowResult;
    };
```

### 7.5 lesson3 每一步用 stream

建议新增一个内部函数：

```ts
async function runAgentStepWithStream<TOutput>(input: {
  step: Lesson3WorkflowStep;
  agent: ReturnType<typeof createAgent>;
  messages: Array<{ role: "user"; content: string }>;
  schema: z.ZodType<TOutput>;
  onEvent?: (event: Lesson3WorkflowEvent) => void;
}): Promise<TOutput>;
```

它内部做：

```ts
const stream = await agent.stream(
  { messages },
  { streamMode: "values" },
);

let structuredResponse: TOutput | undefined;

for await (const chunk of stream) {
  // emit agent_update
  // emit tool_calls
  // emit step_structured_response
}

return schema.parse(structuredResponse);
```

然后主 workflow：

```ts
export async function runLesson3WorkflowWithStream(
  visualReport: VisualAnalysisReport,
  onEvent?: (event: Lesson3WorkflowEvent) => void,
): Promise<Lesson3WorkflowResult> {
  onEvent?.({ type: "workflow_start", input: visualReport });

  onEvent?.({ type: "step_start", step: "content_strategy" });
  const strategyBrief = await runAgentStepWithStream(...);
  onEvent?.({ type: "step_end", step: "content_strategy", outputType: "ContentStrategyBrief" });

  onEvent?.({ type: "step_start", step: "copywriting" });
  const copywritingOutput = await runAgentStepWithStream(...);
  onEvent?.({ type: "step_end", step: "copywriting", outputType: "CopywritingOutput" });

  onEvent?.({ type: "step_start", step: "seo_optimization" });
  const finalReport = await runAgentStepWithStream(...);
  onEvent?.({ type: "step_end", step: "seo_optimization", outputType: "SEOOptimizedNoteReport" });

  const result = { ... };

  onEvent?.({ type: "workflow_end", result });

  return result;
}
```

这样 lesson3 就真正是“stream 可观察的 sequential workflow”，而不是黑盒 invoke。

### 7.6 `lesson3/ink.tsx`

Ink UI 可以展示三个步骤的状态：

```text
LangChain Sequential Workflow

[1/3] 内容策略生成       ✅ 完成
[2/3] 文案撰写           ⏳ 执行中
[3/3] SEO 优化           pending

当前状态：
正在调用工具：Save_Intermediate_Product_Tool

格式化日志：xxx.pretty.log
JSONL 日志：xxx.jsonl
```

最终展示：

```text
SEO 优化后的标题
SEO 优化后的正文
标签
优化总结
任务输出摘要
```

运行方式：

```sh
bun run src/course_01/lesson3/ink.tsx
```

---

## 8. 不再保留 Console runner

所有 lesson 都不再保留独立的 `console.ts` runner。

原因：

```text
1. 课程运行入口统一为 Ink UI
2. Agent / Workflow 层只暴露 stream event，不直接 console.log
3. 调试信息通过 Ink 当前状态展示
4. 完整执行轨迹通过 Pino 写入 .jsonl 和 .pretty.log
5. 避免 console 输出和 Ink stdout 渲染互相干扰
```

因此每课只保留：

```text
lesson1/agent.ts + lesson1/ink.tsx
lesson2/agent.ts + lesson2/ink.tsx
lesson3/workflow.ts + lesson3/ink.tsx
```

边界变为：

```text
agent/workflow 层：负责产生 stream event 和最终结果
ink.tsx：负责渲染 UI、展示日志路径、接入 file logger
file-logger.ts：负责写入 JSONL 与 pretty 日志
```

---

## 9. 运行方式与 package.json 约定

无需在 `package.json` 中增加新的 lesson 脚本。

运行时直接使用 Bun 执行对应 Ink 入口：

```sh
bun run src/course_01/lesson1/ink.tsx
bun run src/course_01/lesson2/ink.tsx
bun run src/course_01/lesson3/ink.tsx
bun run src/course_01/lesson4/ink.tsx
```

如果需要传入参数，例如 lesson1 的用户输入，可以直接追加参数：

```sh
bun run src/course_01/lesson1/ink.tsx "我今天健身了，感觉很开心，帮我设计一篇笔记"
```

不新增 package scripts 的好处：

```text
1. package.json 保持简洁
2. 每个 lesson 的真实入口路径更加显式
3. 减少脚本名和文件结构之间的同步成本
```

---

## 10. 日志目录建议

按照折中方案实现：每个 lesson 的日志写入该 lesson 目录下的 `logs/` 子目录。

也就是：

```text
src/course_01/lesson1/logs/
src/course_01/lesson2/logs/
src/course_01/lesson3/logs/
src/course_01/lesson4/logs/
```

实现方式：

```ts
const logDir = path.join(__dirname, "logs");
```

这样做的原因：

```text
1. 日志仍然贴近课程目录，方便学习者找到
2. 运行产物不会直接散落在源码文件旁边
3. 每个 lesson 的日志天然隔离
4. 后续清理时可以直接删除对应 lesson 的 logs/ 目录
```

每次运行默认生成两份日志：

```text
src/course_01/lessonN/logs/<runId>.jsonl
src/course_01/lessonN/logs/<runId>.pretty.log
```

其中：

```text
.jsonl      机器可读，适合 jq 查询
.pretty.log 人类可读，适合直接打开审查
```

---

## 11. 关键共用能力

建议新增两个 helper。

### 11.1 `src/helper/agent-stream.ts`

负责：

```ts
export type AgentStreamEvent<TStructuredResponse>;
export function getToolCalls(message: unknown): ToolCall[];
export function maskBase64ImageContent(content: unknown): unknown;
export function createAgentUpdateEvent(...): AgentStreamEvent;
export function createToolCallsEvent(...): AgentStreamEvent;
```

lesson1、lesson2、lesson4 复用。

lesson3 也可以复用 `getToolCalls` 和 `maskBase64ImageContent`。

### 11.2 `src/helper/file-logger.ts`

从 lesson4 专用改成通用：

```ts
export function createAgentRunFileLogger<TEvent, TResult>(...);
```

所有课程都使用：

```ts
const fileLogger = createAgentRunFileLogger<LessonNEvent, LessonNResult>({
  logDir,
  runName: "lessonN",
  format: "both",
  normalizeEvent: normalizeLessonNEventForLog,
});
```

---

## 12. 推荐实施顺序

建议按这个顺序改，风险最低。

### 第一步：先泛化 helper

```text
src/helper/file-logger.ts
src/helper/agent-stream.ts
```

并同步更新 lesson4，确保 lesson4 仍然能跑。

原因：lesson4 已经是目标形态，是最好的回归样本。

### 第二步：改 lesson1

lesson1 最简单：

```text
无结构化 schema
单 Agent
已有 stream
```

先用它验证：

```text
目录化
Ink UI
Pino both 日志
无 console runner
```

### 第三步：改 lesson2

lesson2 是：

```text
单 Agent
有结构化 schema
有 structuredResponse
```

它验证：

```text
responseFormat + stream + Ink structured report
```

### 第四步：改 lesson3

lesson3 最复杂：

```text
多 Agent
顺序 workflow
每一步结构化输出
```

最后改它，复用前面沉淀好的 helper。

---

## 13. lesson1-3 的最终抽象差异

| Lesson | 形态 | Agent 数量 | 输出 | 推荐文件 |
|---|---:|---:|---|---|
| lesson1 | 单 Agent | 1 | 最后一条 AI 消息 | `agent.ts` |
| lesson2 | 单 Agent + schema | 1 | `ContentStrategyBrief` | `agent.ts` |
| lesson3 | Sequential Workflow | 3 | `SEOOptimizedNoteReport` + 中间产物 | `workflow.ts` |
| lesson4 | 多模态单 Agent | 1 | `ImageAnalysis` | `agent.ts` |

---

## 14. 最终效果

运行方式统一：

```sh
bun run src/course_01/lesson1/ink.tsx
bun run src/course_01/lesson2/ink.tsx
bun run src/course_01/lesson3/ink.tsx
bun run src/course_01/lesson4/ink.tsx
```

每次运行都会产生：

```text
xxx.jsonl
xxx.pretty.log
```

Ink UI 展示：

```text
当前状态
日志文件路径
最终结构化/文本结果
```

文件日志保存：

```text
run_start
agent_update
tool_calls
structured_response
run_end
```

lesson3 额外保存：

```text
workflow_start
step_start
step_structured_response
step_end
workflow_end
```

---

## 15. 结论

推荐用下面的统一架构改造 lesson1-3：

```text
1. 每课目录化
2. Agent / Workflow 逻辑和 UI 分离
3. 所有执行过程统一通过 stream event 暴露
4. Ink 只负责渲染
5. Pino logger 只负责持久化 event
6. lesson3 用 workflow event 表达 sequential process
7. helper 层抽通用能力，避免 lesson1-4 重复代码
```

建议下一步先做：

```text
泛化 src/helper/file-logger.ts
新增 src/helper/agent-stream.ts
回归更新 lesson4
```

然后再依次迁移 lesson1、lesson2、lesson3。
