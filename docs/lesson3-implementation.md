# CrewAI Sequential Process 迁移方案

> 目标：基于 `docs/lesson2-implementation.md` 已确立的范式，迁移 `/Users/viking/workspaces/crewai_mas_demo/m2l5/m2l5_crew.py`。
>
> 结论先行：`m2l5_crew.py` 的核心不是“Crew 这个类”，而是 **三个结构化 Agent 按依赖顺序执行，并把上游结构化输出作为下游上下文**。
>
> 在当前 LangChain + TypeScript 项目中，推荐实现为：
>
> ```text
> Zod Schema 定义每个 Task 的输入/输出契约
>         ↓
> createAgent 分别创建 contentStrategist / contentWriter / seoOptimizer
>         ↓
> async 函数按顺序 invoke 三个 Agent
>         ↓
> 每一步读取 structuredResponse，并显式注入下一步 user message
>         ↓
> 返回最终 SEOOptimizedNoteReport，同时保留每个阶段的结构化产物
> ```

---

## 1. 设计的核心结论

原 CrewAI 示例 `m2l5_crew.py` 演示的是 `Process.sequential`：

```text
visual_report 输入
      ↓
task_content_strategy
      ↓ 输出 ContentStrategyBrief
      ↓
task_copywriting
      ↓ 输出 CopywritingOutput
      ↓
task_seo_optimization
      ↓ 输出 SEOOptimizedNoteReport
```

迁移到 LangChain + TypeScript 时，不需要强行寻找一个和 CrewAI `Crew` 完全同名的概念。

从第一性原理看，`Process.sequential` 本质只有三件事：

1. **顺序约束**：任务必须按固定顺序执行；
2. **上下文传递**：下游任务能看到上游任务的输出；
3. **输出契约**：每个任务的最终结果必须符合指定结构。

因此当前项目最直接、最可教学、最稳定的实现方式是：

```ts
const strategy = await runContentStrategy(visualReport);
const copywriting = await runCopywriting(visualReport, strategy);
const finalReport = await runSeoOptimization(strategy, copywriting);
```

也就是用普通 TypeScript `async/await` 明确表达 Sequential Process。

> 如果后续课程要演示复杂分支、循环、人工审批、状态恢复，再引入 LangGraph；本课不建议为了“像 CrewAI”而过早引入图编排。

---

## 2. 关键事实

### 2.1 继续沿用 lesson1 / lesson2 的项目范式

当前项目已经确认的核心范式是：

```ts
import { createAgent } from "langchain";
import * as z from "zod";
import { AliyunQwenChatModel } from "../llm/aliyun-qwen-chat-model";
import { saveIntermediateProductTool } from "../tools/intermediate-tool";
```

lesson3 不应另起炉灶，应继续使用：

- 项目自定义 `AliyunQwenChatModel`；
- LangChain `createAgent`；
- 已有 `saveIntermediateProductTool`；
- Zod `responseFormat`；
- Bun 运行 TypeScript。

### 2.2 工具名称必须使用项目中的精确名称

Python 示例中 prompt 写的是 `IntermediateTool`。

但当前项目工具名是：

```text
Save_Intermediate_Product_Tool
```

所以 lesson3 的 system prompt 和 task message 都应写：

```text
使用 Save_Intermediate_Product_Tool 工具保存中间思考过程
```

不要写 `IntermediateTool`，否则模型可能调用不存在的工具名。

### 2.3 字段命名建议：代码使用 camelCase，文档保留 Python 对照

`docs/lesson2-implementation.md` 曾建议为了迁移理解成本保留 snake_case。

但当前实际代码 `src/course_01/lesson2.ts` 已经使用 TypeScript 风格的 camelCase，例如：

```ts
userRawIntent
analyzedImages
inputEvaluation
seoKeywords
```

为了 lesson3 和当前仓库代码保持一致，推荐：

- **TypeScript Schema 使用 camelCase**；
- **迁移映射表中保留 Python snake_case 对照**。

这样既符合当前代码风格，也不丢失 CrewAI 原文件的可追溯性。

---

## 3. CrewAI 到 LangChain TypeScript 的映射关系

| CrewAI 概念 | Python 写法 | LangChain + TS 写法 | 说明 |
|---|---|---|---|
| `BaseModel` | `class ContentStrategyBrief(BaseModel)` | `z.object(...)` | 用 Zod 定义结构化输出契约 |
| `Field(description=...)` | `Field(..., description="...")` | `z.string().describe("...")` | 字段说明继续作为模型输出约束 |
| `Agent.role` | `role='资深小红书增长策略专家'` | 写入 `systemPrompt` | 唤醒专业知识域 |
| `Agent.goal` | `goal='...'` | 写入 `systemPrompt` | 定义任务价值导向 |
| `Agent.backstory` | `backstory="""..."""` | 写入 `systemPrompt` | 定义行为风格和边界 |
| `Agent.tools` | `tools=[IntermediateTool()]` | `tools: [saveIntermediateProductTool]` | 复用项目已有工具 |
| `Agent.llm` | `AliyunLLM(...)` | `new AliyunQwenChatModel(...)` | 复用项目模型封装 |
| `output_pydantic` | `output_pydantic=CopywritingOutput` | `responseFormat: CopywritingOutputSchema` | 结构化输出约束 |
| `Task.description` | 多行字符串 + `{visual_report}` | `createXxxTaskMessage(...)` | 用函数生成 user message |
| `Task.expected_output` | 自然语言期望 | task message 的“最终输出要求” | 给模型看的交付标准 |
| `Task.context` | `context=[task_content_strategy]` | 把上一步 `structuredResponse` 序列化后注入下一步 message | 显式上下文传递 |
| `Crew(tasks=[...])` | `Crew(...)` | `runXiaohongshuSequentialWorkflow(...)` | 普通 async 函数表达工作流 |
| `Process.sequential` | `process=Process.sequential` | `await step1; await step2; await step3;` | 顺序执行 |
| `crew.kickoff(inputs)` | `crew.kickoff({ visual_report })` | `runXiaohongshuSequentialWorkflow(visualReport)` | 顶层入口 |
| `result.pydantic` | 最终 Pydantic 输出 | `finalReport` / `result.structuredResponse` | 最终结构化结果 |
| `result.tasks_output` | 所有任务输出 | 自定义 `tasksOutput` 数组 | 显式保存每一步输出 |

---

## 4. lesson3 的文件定位

建议新增：

```text
src/course_01/lesson3.ts
```

对应本文档：

```text
docs/lesson3-implementation.md
```

lesson3 的教学主题建议是：

```text
从“单 Task 契约输出” -> “Sequential Process 多任务编排”
```

---

## 5. Zod Schema 设计

### 5.1 ImageAnalysisSchema

对应 Python：

```python
class ImageAnalysis(BaseModel):
    file_name: str
    subject_description: str
    atmosphere_vibe: str
    visual_details: List[str]
    image_quality_score: str
    highlight_feature: str
```

推荐 TypeScript：

```ts
export const ImageAnalysisSchema = z.object({
  fileName: z.string().describe("图片文件名或 ID。"),
  subjectDescription: z
    .string()
    .describe("【主体内容】客观描述画面中的核心物体、人物或场景。"),
  atmosphereVibe: z
    .string()
    .describe("【风格氛围】用形容词描述画面的情绪价值。"),
  visualDetails: z
    .array(z.string())
    .describe("【细节点列表】列出画面中容易被忽略但具象的元素。"),
  imageQualityScore: z
    .string()
    .describe("【质量评价】1-10 分打分，基于构图、光线和清晰度。"),
  highlightFeature: z
    .string()
    .describe("【突出特点】这张图最抓人眼球的一个视觉锚点。"),
});
```

### 5.2 VisualAnalysisReportSchema

```ts
export const VisualAnalysisReportSchema = z.object({
  userRawIntent: z.string().describe("用户的原始文字诉求摘要。"),
  analyzedImages: z
    .array(ImageAnalysisSchema)
    .describe("包含所有输入图片的详细分析列表。"),
  overallVisualSummary: z
    .string()
    .describe("综合所有图片得出的整体视觉基调总结。"),
});
```

### 5.3 ContentStrategyBriefSchema

```ts
export const ContentStrategyBriefSchema = z.object({
  inputEvaluation: z
    .string()
    .describe("【素材评估】基于用户诉求和图片质量的综合评价，指出优势和劣势，并给出修图建议。"),
  targetAudiencePersona: z
    .string()
    .describe("【目标受众画像】采用反漏斗模型，定义最核心的细分人群。"),
  corePainPoint: z
    .string()
    .describe("【核心痛点/诉求】受众最想解决的问题或最渴望的情绪价值。"),
  suggestedTitle: z
    .string()
    .describe("【建议标题】痛点场景 + 情绪/利益钩子 + 核心人群标签，包含标点符号和 Emoji，20 字以内。"),
  contentOutline: z
    .array(z.string())
    .describe("【笔记大纲】笔记正文的结构安排。"),
  engagementStrategy: z
    .string()
    .describe("【点赞评论诱饵】设计具体的策略来引发评论互动。"),
  retentionStrategy: z
    .string()
    .describe("【收藏诱饵】提供具体的实用价值让用户点击收藏。"),
  seoKeywords: z
    .array(z.string())
    .length(3)
    .describe("【关键词布局】基于 KFS 策略，列出 3 个必须埋入文案的长尾关键词。"),
});
```

### 5.4 CopywritingOutputSchema

对应 Python：

```python
class CopywritingOutput(BaseModel):
    title: str
    content: str
    picture_list: List[ImageAnalysis]
```

推荐 TypeScript：

```ts
export const CopywritingOutputSchema = z.object({
  title: z
    .string()
    .describe("【笔记标题】完整的小红书笔记标题，包含 Emoji 和标点符号。"),
  content: z
    .string()
    .describe("【笔记正文】完整的小红书笔记正文内容，按照策略简报中的内容大纲撰写。"),
  pictureList: z
    .array(ImageAnalysisSchema)
    .describe("【图片列表】根据视觉元素描述筛选合适的图片并按照合理的顺序排序，特别重视第一张图片的选择。"),
});
```

### 5.5 SEOOptimizedNoteReportSchema

对应 Python：

```python
class SEOOptimizedNoteReport(BaseModel):
    optimization_summary: str
    optimized_title: str
    optimized_content: str
    optimized_picture_list: List[ImageAnalysis]
    tags: List[str]
```

推荐 TypeScript：

```ts
export const SEOOptimizedNoteReportSchema = z.object({
  optimizationSummary: z
    .string()
    .describe("【优化总结】说明本次 SEO 优化的重点和改进点，包括关键词密度、自然度、搜索占位策略等。"),
  optimizedTitle: z
    .string()
    .describe("【优化后的标题】在原始标题基础上进行 SEO 优化的结果，要保持原来的风格。"),
  optimizedContent: z
    .string()
    .describe("【优化后的正文】在原始正文基础上进行 SEO 优化，自然融入长尾关键词，确保关键词密度合理，不影响阅读体验。"),
  optimizedPictureList: z
    .array(ImageAnalysisSchema)
    .describe("【优化后的图片列表】根据优化后的正文，筛选合适的图片并按照合理的顺序排序。"),
  tags: z
    .array(z.string())
    .min(5)
    .max(8)
    .describe("基于 SEO 生成的 5-8 个标签。"),
});
```

### 5.6 TypeScript 类型

```ts
type VisualAnalysisReport = z.infer<typeof VisualAnalysisReportSchema>;
type ContentStrategyBrief = z.infer<typeof ContentStrategyBriefSchema>;
type CopywritingOutput = z.infer<typeof CopywritingOutputSchema>;
type SEOOptimizedNoteReport = z.infer<typeof SEOOptimizedNoteReportSchema>;
```

---

## 6. Agent 设计

### 6.1 contentStrategist

对应 Python：

```python
content_strategist = Agent(..., output_pydantic=ContentStrategyBrief)
```

LangChain TypeScript：

```ts
const contentStrategist = createAgent({
  model: llm,
  tools: [saveIntermediateProductTool],
  systemPrompt: contentStrategistSystemPrompt,
  responseFormat: ContentStrategyBriefSchema,
});
```

`contentStrategistSystemPrompt` 应包含：

```ts
const contentStrategistSystemPrompt = `
你是：资深小红书增长策略专家。

你的目标：
基于 CES 互动评分算法，为产品制定一套能穿透 "L1 冷启动池" 并具有长尾搜索价值的内容策略。

你的背景：
你曾是国内顶级 MCN 机构的内容总监，深谙小红书 2025 年的算法变迁。
你不再相信简单的流量铺张，而是坚信 "价值耕耘" 和 "KFS 闭环"。

**核心理论储备**：
- CES 评分机制：关注 8 分 > 评论 4 分 > 收藏 1 分 > 点赞 1 分，优先考虑如何提升关注、评论和收藏
- 反漏斗模型 Anti-Funnel：坚持 "窄即是宽"，先锁定最精准的核心人群，再寻求破圈
- 语义工程 SOP：爆款标题公式【痛点场景】+【解决方案 / 情绪钩子】+【群体标签】

**行为边界**：
- 只负责输出策略大纲 Brief
- 绝对不要撰写最终正文
- 绝对不要撰写完整示例文案
- 不允许委派给其他 Agent
- 必须使用 Save_Intermediate_Product_Tool 工具保存中间结果
- 所有思考过程、工具调用和最终输出都必须使用中文

**结构化输出要求**：
最终结果必须符合 ContentStrategyBrief 结构。
不要在结构化结果之外额外输出无关解释。
`.trim();
```

### 6.2 contentWriter

对应 Python：

```python
content_writer = Agent(..., output_pydantic=CopywritingOutput)
```

LangChain TypeScript：

```ts
const contentWriter = createAgent({
  model: llm,
  tools: [saveIntermediateProductTool],
  systemPrompt: contentWriterSystemPrompt,
  responseFormat: CopywritingOutputSchema,
});
```

推荐 system prompt：

```ts
const contentWriterSystemPrompt = `
你是：资深 MCN 内容撰写编辑。

你的目标：
基于内容策划简报和视觉分析报告，撰写一篇具有高互动率和情绪价值的小红书笔记文案，并生成图片列表。

你的背景：
你是国内头部 MCN 机构的首席内容编辑，拥有 5 年以上的小红书内容创作经验。
你深谙小红书用户的阅读习惯和互动心理，擅长将策略转化为具有感染力的文案。

**核心理论储备**：
- 黄金 3 秒法则：笔记的前 3 秒决定用户是否继续阅读
- 沉浸式体验描述：用细节和感官描述让用户产生身临其境的感觉
- 情绪价值传递：小红书用户不仅需要信息，更需要情绪共鸣和情感慰藉
- 互动引导技巧：在文案中自然植入互动钩子，引导用户评论、收藏、点赞

**行为边界**：
- 必须严格按照内容策划简报的要求撰写，不能偏离策略方向
- 只负责撰写文案和图片排序，不进行 SEO 优化
- 保持原创性，避免抄袭和模板化
- 不允许委派给其他 Agent
- 必须使用 Save_Intermediate_Product_Tool 工具保存中间结果
- 所有输出必须使用中文

**结构化输出要求**：
最终结果必须符合 CopywritingOutput 结构。
不要在结构化结果之外额外输出无关解释。
`.trim();
```

### 6.3 seoOptimizer

对应 Python：

```python
seo_optimizer = Agent(..., output_pydantic=SEOOptimizedNoteReport)
```

LangChain TypeScript：

```ts
const seoOptimizer = createAgent({
  model: llm,
  tools: [saveIntermediateProductTool],
  systemPrompt: seoOptimizerSystemPrompt,
  responseFormat: SEOOptimizedNoteReportSchema,
});
```

推荐 system prompt：

```ts
const seoOptimizerSystemPrompt = `
你是：资深小红书搜索优化专家。

你的目标：
基于内容策划简报和文案撰写产出，对小红书笔记进行搜索和推荐优化，确保关键词自然融入，提高笔记的搜索排名和长尾流量。

你的背景：
你是小红书 SEO 领域的资深专家，专注于帮助内容创作者提升笔记的搜索排名和自然流量。
你深谙小红书的搜索算法和关键词排名机制，擅长在不影响内容质量的前提下进行 SEO 优化。

**核心理论储备**：
- KFS 策略：关键词、内容、搜索的闭环逻辑
- 长尾关键词优化：长尾关键词比短词更容易获得排名
- 关键词密度：要适中，过密会被判定为关键词堆砌，过稀则无法获得排名
- 自然融入技巧：将关键词自然融入文案，确保优化后的文案仍然流畅可读
- 搜索占位策略：通过关键词布局抢占搜索流量入口

**行为边界**：
- 优化不能以牺牲内容质量为代价
- 不能改变文案的核心观点、情绪价值和互动策略
- 关键词必须自然融入，不能出现关键词堆砌
- 不允许委派给其他 Agent
- 必须使用 Save_Intermediate_Product_Tool 工具保存中间结果
- 所有输出必须使用中文

**结构化输出要求**：
最终结果必须符合 SEOOptimizedNoteReport 结构。
不要在结构化结果之外额外输出无关解释。
`.trim();
```

---

## 7. Task Message 设计

### 7.1 内容策划任务

对应 Python：

```python
task_content_strategy = Task(
    description="""... {visual_report} ...""",
    output_pydantic=ContentStrategyBrief,
)
```

TypeScript：

```ts
function createContentStrategyTaskMessage(visualReport: VisualAnalysisReport) {
  return `
**任务要求**：
1. 仔细分析视觉报告中的用户意图、图片质量和整体风格
2. 基于 CES 算法和反漏斗模型，制定精准的内容策略
3. 策略要具体可执行，不能泛泛而谈
4. 使用 Save_Intermediate_Product_Tool 工具保存中间思考过程
5. 最终输出必须符合 ContentStrategyBrief 结构

视觉分析报告如下：
${JSON.stringify(visualReport, null, 2)}

**重要提示**：
- 必须基于输入的视觉分析报告进行分析
- 策略要符合小红书平台的算法特点
- 所有输出必须使用中文
`.trim();
}
```

### 7.2 文案撰写任务

CrewAI 中的：

```python
context=[task_content_strategy]
```

在 TypeScript 中要显式传入 `contentStrategyBrief`：

```ts
function createCopywritingTaskMessage(
  visualReport: VisualAnalysisReport,
  strategyBrief: ContentStrategyBrief,
) {
  return `
**任务要求**：
1. 仔细阅读视觉分析报告和内容策划简报
2. 基于策略简报中的目标受众、核心痛点、内容大纲等要求撰写完整的小红书笔记文案
3. 确保文案与视觉分析报告中的图片风格和氛围感一致
4. 在文案中自然植入互动钩子，引导用户评论、收藏
5. 根据文案和视觉分析报告筛选合适的图片并排序，特别重视第一张图片的选择
6. 使用 Save_Intermediate_Product_Tool 工具保存中间思考过程
7. 最终输出必须符合 CopywritingOutput 结构

视觉分析报告如下：
${JSON.stringify(visualReport, null, 2)}

内容策划简报如下：
${JSON.stringify(strategyBrief, null, 2)}

**重要提示**：
- 必须严格按照内容策划简报的要求撰写，不能偏离策略方向
- 文案要具有情绪价值，能够引发目标受众的共鸣
- 只做文案撰写，不做 SEO 优化
- 所有输出必须使用中文
`.trim();
}
```

### 7.3 SEO 优化任务

CrewAI 中的：

```python
context=[task_content_strategy, task_copywriting]
```

在 TypeScript 中显式传入两个上游结构化输出：

```ts
function createSeoOptimizationTaskMessage(
  strategyBrief: ContentStrategyBrief,
  copywritingOutput: CopywritingOutput,
) {
  return `
**任务要求**：
1. 仔细阅读内容策划简报中的 SEO 关键词列表
2. 分析文案撰写产出中的关键词分布和密度
3. 在不改变文案核心内容和风格的前提下，对文案进行 SEO 优化
4. 确保关键词自然融入，密度合理，不出现关键词堆砌
5. 优化标题、正文和标签，提升笔记的搜索排名潜力
6. 根据优化后的正文，筛选合适的图片并排序，特别重视第一张图片的选择
7. 使用 Save_Intermediate_Product_Tool 工具保存中间思考过程
8. 最终输出必须符合 SEOOptimizedNoteReport 结构

内容策划简报如下：
${JSON.stringify(strategyBrief, null, 2)}

文案撰写产出如下：
${JSON.stringify(copywritingOutput, null, 2)}

**重要提示**：
- 优化不能以牺牲内容质量为代价
- 关键词必须自然融入，不能影响阅读体验
- 不要改变原文案的核心情绪价值和互动策略
- 所有输出必须使用中文
`.trim();
}
```

---

## 8. Sequential Process 编排设计

### 8.1 不推荐把三个 Agent 并行执行

这三个任务存在真实依赖关系：

```text
contentWriter 依赖 contentStrategist 的策略简报
seoOptimizer 依赖 contentStrategist 的 SEO 关键词 + contentWriter 的原始文案
```

因此不能并行：

```ts
// 不推荐
await Promise.all([
  contentStrategist.invoke(...),
  contentWriter.invoke(...),
  seoOptimizer.invoke(...),
]);
```

正确做法是顺序执行：

```ts
const strategyResult = await contentStrategist.invoke(...);
const copywritingResult = await contentWriter.invoke(...);
const seoResult = await seoOptimizer.invoke(...);
```

### 8.2 推荐顶层工作流函数

```ts
type SequentialWorkflowResult = {
  strategyBrief: ContentStrategyBrief;
  copywritingOutput: CopywritingOutput;
  finalReport: SEOOptimizedNoteReport;
  tasksOutput: Array<{
    taskName: string;
    outputType: string;
    structuredResponse: unknown;
  }>;
};

async function runXiaohongshuSequentialWorkflow(
  visualReport: VisualAnalysisReport,
): Promise<SequentialWorkflowResult> {
  const parsedVisualReport = VisualAnalysisReportSchema.parse(visualReport);

  const strategyResult = await contentStrategist.invoke({
    messages: [
      {
        role: "user",
        content: createContentStrategyTaskMessage(parsedVisualReport),
      },
    ],
  });

  const strategyBrief = ContentStrategyBriefSchema.parse(
    strategyResult.structuredResponse,
  );

  const copywritingResult = await contentWriter.invoke({
    messages: [
      {
        role: "user",
        content: createCopywritingTaskMessage(parsedVisualReport, strategyBrief),
      },
    ],
  });

  const copywritingOutput = CopywritingOutputSchema.parse(
    copywritingResult.structuredResponse,
  );

  const seoResult = await seoOptimizer.invoke({
    messages: [
      {
        role: "user",
        content: createSeoOptimizationTaskMessage(
          strategyBrief,
          copywritingOutput,
        ),
      },
    ],
  });

  const finalReport = SEOOptimizedNoteReportSchema.parse(
    seoResult.structuredResponse,
  );

  return {
    strategyBrief,
    copywritingOutput,
    finalReport,
    tasksOutput: [
      {
        taskName: "task_content_strategy",
        outputType: "ContentStrategyBrief",
        structuredResponse: strategyBrief,
      },
      {
        taskName: "task_copywriting",
        outputType: "CopywritingOutput",
        structuredResponse: copywritingOutput,
      },
      {
        taskName: "task_seo_optimization",
        outputType: "SEOOptimizedNoteReport",
        structuredResponse: finalReport,
      },
    ],
  };
}
```

---

## 9. 完整 lesson3 示例设计

下面是推荐的 `src/course_01/lesson3.ts` 结构。

```ts
/**
 从“单 Task 契约输出” -> “Sequential Process 多任务编排”

 CrewAI 中 Process.sequential 的三个关键点：
 - 顺序约束：任务必须按 tasks 数组顺序执行
 - 上下文传递：下游 Task 通过 context 读取上游 Task 输出
 - 契约传递：每个 Task 都用 output_pydantic 保证输出结构

 在 LangChain + TypeScript 中，对应为：
 - async/await：显式表达任务顺序
 - JSON.stringify(structuredResponse)：显式把上游结构化结果注入下游 user message
 - responseFormat + Zod.parse：定义并校验每一步结构化输出
*/

import { createAgent } from "langchain";
import * as z from "zod";
import { AliyunQwenChatModel } from "../llm/aliyun-qwen-chat-model";
import { saveIntermediateProductTool } from "../tools/intermediate-tool";

export const ImageAnalysisSchema = z.object({
  fileName: z.string().describe("图片文件名或 ID。"),
  subjectDescription: z
    .string()
    .describe("【主体内容】客观描述画面中的核心物体、人物或场景。"),
  atmosphereVibe: z
    .string()
    .describe("【风格氛围】用形容词描述画面的情绪价值。"),
  visualDetails: z
    .array(z.string())
    .describe("【细节点列表】列出画面中容易被忽略但具象的元素。"),
  imageQualityScore: z
    .string()
    .describe("【质量评价】1-10 分打分，基于构图、光线和清晰度。"),
  highlightFeature: z
    .string()
    .describe("【突出特点】这张图最抓人眼球的一个视觉锚点。"),
});

export const VisualAnalysisReportSchema = z.object({
  userRawIntent: z.string().describe("用户的原始文字诉求摘要。"),
  analyzedImages: z
    .array(ImageAnalysisSchema)
    .describe("包含所有输入图片的详细分析列表。"),
  overallVisualSummary: z
    .string()
    .describe("综合所有图片得出的整体视觉基调总结。"),
});

export const ContentStrategyBriefSchema = z.object({
  inputEvaluation: z
    .string()
    .describe("【素材评估】基于用户诉求和图片质量的综合评价，指出优势和劣势，并给出修图建议。"),
  targetAudiencePersona: z
    .string()
    .describe("【目标受众画像】采用反漏斗模型，定义最核心的细分人群。"),
  corePainPoint: z
    .string()
    .describe("【核心痛点/诉求】受众最想解决的问题或最渴望的情绪价值。"),
  suggestedTitle: z
    .string()
    .describe("【建议标题】痛点场景 + 情绪/利益钩子 + 核心人群标签，20 字以内。"),
  contentOutline: z
    .array(z.string())
    .describe("【笔记大纲】正文结构安排。"),
  engagementStrategy: z
    .string()
    .describe("【点赞评论诱饵】设计具体策略来引发评论互动。"),
  retentionStrategy: z
    .string()
    .describe("【收藏诱饵】提供具体实用价值让用户点击收藏。"),
  seoKeywords: z
    .array(z.string())
    .length(3)
    .describe("【关键词布局】基于 KFS 策略，列出 3 个必须埋入文案的长尾关键词。"),
});

export const CopywritingOutputSchema = z.object({
  title: z.string().describe("【笔记标题】完整的小红书笔记标题，包含 Emoji 和标点符号。"),
  content: z.string().describe("【笔记正文】完整的小红书笔记正文内容。"),
  pictureList: z
    .array(ImageAnalysisSchema)
    .describe("【图片列表】根据视觉元素描述筛选合适的图片并排序。"),
});

export const SEOOptimizedNoteReportSchema = z.object({
  optimizationSummary: z.string().describe("【优化总结】说明本次 SEO 优化的重点和改进点。"),
  optimizedTitle: z.string().describe("【优化后的标题】在原始标题基础上进行 SEO 优化。"),
  optimizedContent: z.string().describe("【优化后的正文】自然融入长尾关键词。"),
  optimizedPictureList: z
    .array(ImageAnalysisSchema)
    .describe("【优化后的图片列表】根据优化后的正文筛选并排序。"),
  tags: z.array(z.string()).min(5).max(8).describe("基于 SEO 生成的 5-8 个标签。"),
});

type VisualAnalysisReport = z.infer<typeof VisualAnalysisReportSchema>;
type ContentStrategyBrief = z.infer<typeof ContentStrategyBriefSchema>;
type CopywritingOutput = z.infer<typeof CopywritingOutputSchema>;
type SEOOptimizedNoteReport = z.infer<typeof SEOOptimizedNoteReportSchema>;

const contentStrategistSystemPrompt = `...`.trim();
const contentWriterSystemPrompt = `...`.trim();
const seoOptimizerSystemPrompt = `...`.trim();

const llm = new AliyunQwenChatModel({
  model: "qwen3.7-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

const contentStrategist = createAgent({
  model: llm,
  tools: [saveIntermediateProductTool],
  systemPrompt: contentStrategistSystemPrompt,
  responseFormat: ContentStrategyBriefSchema,
});

const contentWriter = createAgent({
  model: llm,
  tools: [saveIntermediateProductTool],
  systemPrompt: contentWriterSystemPrompt,
  responseFormat: CopywritingOutputSchema,
});

const seoOptimizer = createAgent({
  model: llm,
  tools: [saveIntermediateProductTool],
  systemPrompt: seoOptimizerSystemPrompt,
  responseFormat: SEOOptimizedNoteReportSchema,
});

function createContentStrategyTaskMessage(visualReport: VisualAnalysisReport) {
  return `...${JSON.stringify(visualReport, null, 2)}...`.trim();
}

function createCopywritingTaskMessage(
  visualReport: VisualAnalysisReport,
  strategyBrief: ContentStrategyBrief,
) {
  return `...${JSON.stringify(visualReport, null, 2)}...${JSON.stringify(strategyBrief, null, 2)}...`.trim();
}

function createSeoOptimizationTaskMessage(
  strategyBrief: ContentStrategyBrief,
  copywritingOutput: CopywritingOutput,
) {
  return `...${JSON.stringify(strategyBrief, null, 2)}...${JSON.stringify(copywritingOutput, null, 2)}...`.trim();
}

async function runXiaohongshuSequentialWorkflow(
  visualReport: VisualAnalysisReport,
) {
  const parsedVisualReport = VisualAnalysisReportSchema.parse(visualReport);

  const strategyResult = await contentStrategist.invoke({
    messages: [
      {
        role: "user",
        content: createContentStrategyTaskMessage(parsedVisualReport),
      },
    ],
  });
  const strategyBrief = ContentStrategyBriefSchema.parse(strategyResult.structuredResponse);

  const copywritingResult = await contentWriter.invoke({
    messages: [
      {
        role: "user",
        content: createCopywritingTaskMessage(parsedVisualReport, strategyBrief),
      },
    ],
  });
  const copywritingOutput = CopywritingOutputSchema.parse(copywritingResult.structuredResponse);

  const seoResult = await seoOptimizer.invoke({
    messages: [
      {
        role: "user",
        content: createSeoOptimizationTaskMessage(strategyBrief, copywritingOutput),
      },
    ],
  });
  const finalReport = SEOOptimizedNoteReportSchema.parse(seoResult.structuredResponse);

  return {
    strategyBrief,
    copywritingOutput,
    finalReport,
    tasksOutput: [
      { taskName: "task_content_strategy", outputType: "ContentStrategyBrief", structuredResponse: strategyBrief },
      { taskName: "task_copywriting", outputType: "CopywritingOutput", structuredResponse: copywritingOutput },
      { taskName: "task_seo_optimization", outputType: "SEOOptimizedNoteReport", structuredResponse: finalReport },
    ],
  };
}

const visualReport: VisualAnalysisReport = {
  userRawIntent: "想卖这个墨绿色马克杯，主打独居女生市场，强调氛围感和情绪价值",
  analyzedImages: [
    {
      fileName: "cup_001.jpg",
      subjectDescription: "一只带有金色裂纹纹理的墨绿色陶瓷马克杯，放置在木质书桌上",
      atmosphereVibe: "静谧、复古、松弛感",
      visualDetails: ["书页上的光斑", "杯口边缘的咖啡渍", "背景虚化的绿植", "暖色调的台灯光线"],
      imageQualityScore: "6分，构图有些杂乱，光线有些暗，清晰度一般",
      highlightFeature: "金色裂纹纹理在暖光下的反光效果",
    },
    {
      fileName: "cup_002.jpg",
      subjectDescription: "同一只马克杯的特写，展示杯身的细节和质感",
      atmosphereVibe: "精致、温暖、治愈",
      visualDetails: ["陶瓷表面的细腻质感", "墨绿色与金色的对比", "杯内残留的咖啡液", "柔和的侧光"],
      imageQualityScore: "8分，构图、光线和清晰度都很好，特写的鱼眼效果稍微有点变形",
      highlightFeature: "墨绿色与金色裂纹的强烈视觉对比",
    },
    {
      fileName: "cup_003.jpg",
      subjectDescription: "一个长发女生的背影，坐在书桌边，手上拿着一个马克杯",
      atmosphereVibe: "慵懒、放松、治愈",
      visualDetails: ["书桌上的台灯", "书桌上的绿植", "书桌上的咖啡杯", "书桌上的笔记本电脑"],
      imageQualityScore: "6分，背景有些杂乱，主体不突出，光线比较平",
      highlightFeature: "女生的背影和书桌上的咖啡杯",
    },
  ],
  overallVisualSummary:
    "整体素材偏向低饱和度的复古风格，色调温暖柔和，适合营造'独处时光'和'精神避难所'的情绪氛围。图片质量较高，构图简洁，但缺乏产品细节展示和场景多样性。",
};

console.log("=".repeat(80));
console.log("开始执行 LangChain Sequential Workflow...");
console.log("=".repeat(80));

const result = await runXiaohongshuSequentialWorkflow(visualReport);

console.log("\n" + "=".repeat(80));
console.log("工作流执行完成！");
console.log("=".repeat(80));

console.log("\n最终输出（结构化数据）:");
console.log(JSON.stringify(result.finalReport, null, 2));

console.log("\n字段访问示例:");
console.log("优化后的标题:", result.finalReport.optimizedTitle);
console.log("优化后的正文:", result.finalReport.optimizedContent);
console.log("优化后的标签:", result.finalReport.tags.join(", "));
console.log("优化总结:", result.finalReport.optimizationSummary);

console.log("\n所有任务的输出:");
for (const [index, taskOutput] of result.tasksOutput.entries()) {
  console.log(`任务 ${index + 1}: ${taskOutput.taskName}`);
  console.log(`  输出类型: ${taskOutput.outputType}`);
  console.log(
    `  结构化输出长度: ${JSON.stringify(taskOutput.structuredResponse).length} 字符`,
  );
}
```

---

## 10. 与 CrewAI `result.tasks_output` 的等价设计

Python 中：

```python
for i, task_output in enumerate(result.tasks_output, 1):
    print(f"任务 {i}: {task_output.description}")
    if task_output.pydantic:
        print(f"输出类型: {type(task_output.pydantic).__name__}")
```

TypeScript 中推荐不要模拟 CrewAI 的内部对象，而是定义清晰的数据结构：

```ts
type WorkflowTaskOutput = {
  taskName: string;
  outputType: string;
  structuredResponse: unknown;
};
```

优点：

1. 简单透明；
2. 不依赖 CrewAI 内部抽象；
3. 更符合 TypeScript 显式建模习惯；
4. 后续如果要落库、打日志、展示 UI，可以直接复用。

---

## 11. 是否需要 LangGraph？

本课不建议引入 LangGraph。

原因：

1. 当前流程是严格线性的三步流程；
2. 没有分支、循环、条件路由、人类审批或状态恢复；
3. 用 `async/await` 更能让学习者看清楚 `Process.sequential` 的本质；
4. lesson3 的重点是“任务调度与信息传递”，不是图工作流框架本身。

可以在课程中补充说明：

```text
CrewAI 的 Process.sequential ≈ TypeScript 的 await step1 → await step2 → await step3。

只有当流程变成：
- 根据策略质量决定是否重写；
- SEO 检查不通过则回到文案阶段；
- 人工审核通过后再发布；
- 多分支 Agent 并行后聚合；

这时才值得引入 LangGraph。
```

---

## 12. invoke 与 stream 的取舍

lesson2 中为了观察工具调用，使用了 `stream`。

lesson3 主流程建议使用 `invoke`，原因是：

```text
Sequential Process 的核心是读取上一步 structuredResponse 作为下一步输入。
invoke 更适合稳定拿最终 structuredResponse。
stream 更适合观察执行轨迹。
```

推荐课程表达：

- 主流程：用 `invoke` 实现稳定的结构化链式传递；
- 调试版：可单独封装 `streamAgentExecution(...)` 观察工具调用过程。

---

## 13. 运行方式

根据项目 Bun 约定，推荐：

```sh
bun src/course_01/lesson3.ts
```

不要使用：

```sh
node src/course_01/lesson3.ts
npx ts-node src/course_01/lesson3.ts
```

Bun 会自动加载 `.env`，所以代码中直接读取：

```ts
process.env["QWEN_API_KEY"]
process.env["QWEN_API_BASE"]
```

---

## 14. 最终设计摘要

lesson3 应体现的教学增量是：

```text
lesson1：单 Agent，自然语言输出
lesson2：单 Agent，结构化输出契约
lesson3：多 Agent，结构化输出链式传递 + Sequential Process
```

实现上最重要的三条原则：

1. **不要神化 Crew**：CrewAI `Crew + Process.sequential` 本质就是顺序执行和上下文传递；
2. **不要丢失契约**：每一步都用独立 Zod Schema + `responseFormat` 约束输出；
3. **不要隐式传递上下文**：下游任务需要什么，就把上游 `structuredResponse` 明确写进 user message。

推荐最终代码结构：

```text
src/course_01/lesson3.ts
├── Zod Schemas
├── TypeScript Types
├── 3 个 systemPrompt
├── 3 个 createXxxTaskMessage 函数
├── 3 个 createAgent 实例
├── runXiaohongshuSequentialWorkflow
├── mock visualReport
└── console 输出最终结果和每个任务结果
```
