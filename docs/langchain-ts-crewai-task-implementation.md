# 参考 `src/course_01/lesson1.ts` 的 CrewAI Task 迁移方案

> 本方案重新基于当前项目已有代码风格设计，不再采用通用的 `ChatPromptTemplate + AgentExecutor + ChatOpenAI` 方案。
>
> 现有项目已经在 `src/course_01/lesson1.ts` 中确定了核心范式：
>
> ```ts
> import { createAgent } from "langchain";
> import { AliyunQwenChatModel } from "../llm/aliyun-qwen-chat-model";
> import { saveIntermediateProductTool } from "../tools/intermediate-tool";
> ```
>
> 因此 lesson2 的设计应继续沿用：**自定义 Qwen ChatModel + LangChain `createAgent` + 项目已有 Intermediate Tool + Zod responseFormat**。

---

## 1. 重新设计的核心结论

原 CrewAI 示例 `m2l4_task.py` 的核心不是“多 Agent 编排”，而是：

```text
用 Pydantic 定义 Task 输出契约
        ↓
让 Agent 基于输入完成任务
        ↓
CrewAI 用 output_pydantic 校验最终结果
```

在当前 TypeScript 项目中，最贴近 `lesson1.ts` 风格的实现应该是：

```text
Zod Schema 定义输入/输出契约
        ↓
createAgent({ model, tools, systemPrompt, responseFormat })
        ↓
agent.invoke({ messages }) 或 agent.stream({ messages })
        ↓
从 result.structuredResponse 读取结构化结果
```

也就是说，lesson2 不应该优先设计成：

```text
ChatPromptTemplate + model.withStructuredOutput + AgentExecutor
```

而应该优先设计成：

```text
createAgent + responseFormat
```

因为这和 `lesson1.ts` 的教学主线一致。

---

## 2. 为什么要按 `lesson1.ts` 重设方案？

`lesson1.ts` 已经体现了当前课程项目的几个关键约定：

### 2.1 使用 `createAgent` 作为 Agent 抽象

`lesson1.ts` 中：

```ts
const contentStrategist = createAgent({
  model: llm,
  tools: [saveIntermediateProductTool],
  systemPrompt: contentStrategistSystemPrompt,
});
```

这说明当前课程不是从底层 Runnable 开始讲，而是把 LangChain 的 `createAgent` 作为 CrewAI `Agent` 的主要映射。

### 2.2 使用项目自定义的 `AliyunQwenChatModel`

`lesson1.ts` 中：

```ts
const llm = new AliyunQwenChatModel({
  model: "qwen3.7-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});
```

因此新方案不应再建议新增 `src/llm/qwen.ts` 并使用 `ChatOpenAI` 封装 Qwen。

当前项目已经有更贴合自身需求的模型封装：

```text
src/llm/aliyun-qwen-chat-model.ts
```

它已经处理了：

- 阿里云 Qwen API 调用；
- tool calling schema 转换；
- tool call 返回解析；
- 多模态消息处理；
- 空内容重试；
- 超时和重试。

所以 lesson2 应复用它，而不是绕开它。

### 2.3 使用已有 `saveIntermediateProductTool`

`lesson1.ts` 中：

```ts
tools: [saveIntermediateProductTool]
```

当前工具位于：

```text
src/tools/intermediate-tool.ts
```

工具名是：

```text
Save_Intermediate_Product_Tool
```

因此 prompt 中必须继续使用这个精确名称，而不是改成 `save_intermediate_result`。

---

## 3. 新的 CrewAI 到 LangChain 映射关系

| CrewAI 概念 | CrewAI 写法 | 本项目 LangChain TS 写法 | 说明 |
|---|---|---|---|
| `Agent.role` | `role="资深小红书增长策略专家"` | 写入 `systemPrompt` | 和 lesson1 一致 |
| `Agent.goal` | `goal="..."` | 写入 `systemPrompt` | 作为价值导向 |
| `Agent.backstory` | `backstory="..."` | 写入 `systemPrompt` | 作为长期行为约束 |
| `Agent.tools` | `tools=[IntermediateTool()]` | `tools: [saveIntermediateProductTool]` | 复用已有工具 |
| `Agent.llm` | `AliyunLLM(...)` | `new AliyunQwenChatModel(...)` | 复用项目模型封装 |
| `Task.description` | 带 `{visual_report}` 的任务描述 | user message content | 通过消息注入输入 |
| `Task.expected_output` | 自然语言说明 | prompt 中的“最终输出要求” | 给模型看的说明 |
| `Task.output_pydantic` | `ContentStrategyBrief` | `responseFormat: ContentStrategyBriefSchema` | 用 Zod 约束结构化结果 |
| `Crew` | `Crew(...)` | 当前单任务不需要单独 Crew | `createAgent` 已经是执行单元 |
| `Process.sequential` | 顺序执行 | 当前只有一个任务，无需显式编排 | 多任务时再引入函数链或 LangGraph |
| `crew.kickoff(inputs)` | `crew.kickoff({ visual_report })` | `agent.invoke({ messages })` | 输入通过 user message 传入 |
| `task.output.pydantic` | Pydantic 对象 | `result.structuredResponse` | 结构化对象 |

---

## 4. 推荐的 lesson2 文件定位

建议新增或重写：

```text
src/course_01/lesson2.ts
```

它对应原 Python 文件：

```text
crewai_mas_demo/m2l4/m2l4_task.py
```

但在教学定位上，应承接 `lesson1.ts`：

```text
lesson1.ts：如何定义 Agent 的 role / goal / backstory / tools
lesson2.ts：如何定义 Task 的输入输出契约，并让 Agent 输出结构化结果
```

也就是说，lesson2 的主题应是：

```text
从“自然语言 Brief”升级到“结构化 Task 输出契约”
```

---

## 5. 推荐目录结构

基于当前项目结构，推荐保持轻量，不要过早拆太多文件。

### 5.1 课程教学版结构

```text
src/
  course_01/
    lesson1.ts                    # 已存在：Agent role / goal / backstory
    lesson2.ts                    # 新增：Task 契约与结构化输出

  llm/
    aliyun-qwen-chat-model.ts     # 已存在：Qwen ChatModel

  tools/
    intermediate-tool.ts          # 已存在：中间结果工具
```

### 5.2 如果后续复用，再拆 schema

当多个 lesson 都要复用这些结构时，再新增：

```text
src/schemas/
  content-strategy.ts
```

但就当前课程连贯性而言，建议 lesson2 先把 schema 写在同一个文件里。

原因：

1. 学习者能在一个文件里看到完整闭环；
2. 更像原 `m2l4_task.py` 的教学脚本；
3. 避免一开始就在目录结构上制造认知负担。

---

## 6. lesson2 的代码设计

### 6.1 顶部教学注释

建议 lesson2 开头延续 lesson1 的风格，用注释先解释概念。

```ts
/**
 从“自然语言输出” -> “契约驱动输出”

 CrewAI 中 Task 的三个关键点：
 - description：任务说明，告诉 Agent 要做什么
 - expected_output：期望产物，告诉 Agent 最终应该交付什么
 - output_pydantic：输出契约，让最终结果必须符合指定结构

 在 LangChain 中，对应为：
 - user message：承载 Task description 和输入变量
 - systemPrompt：承载 Agent 的 role / goal / backstory / 行为边界
 - responseFormat：承载结构化输出契约，对应 CrewAI 的 output_pydantic
*/
```

---

## 7. Zod Schema 设计

原 Python 使用 Pydantic：

```python
class ContentStrategyBrief(BaseModel):
    input_evaluation: str
    seo_keywords: List[str]
```

TypeScript 中使用 Zod。

为了降低迁移理解成本，建议字段名先保留 Python 的 snake_case：

```text
input_evaluation
seo_keywords
```

而不是立刻改成 camelCase。

原因：

1. 和原 CrewAI 文件一一对应；
2. 更容易理解 `output_pydantic` 到 `responseFormat` 的迁移；
3. 结构化输出结果可以直接对照 Python 字段。

### 7.1 推荐 Schema

```ts
import * as z from "zod";

const ImageAnalysisSchema = z.object({
  file_name: z.string().describe("图片文件名或 ID。"),
  subject_description: z
    .string()
    .describe("【主体内容】客观描述画面中的核心物体、人物或场景。"),
  atmosphere_vibe: z
    .string()
    .describe("【风格氛围】用形容词描述画面的情绪价值。"),
  visual_details: z
    .array(z.string())
    .describe("【细节点列表】列出画面中容易被忽略但具象的元素。"),
  image_quality_score: z
    .string()
    .describe("【质量评价】1-10 分打分，基于构图、光线和清晰度给出打分原因。"),
  highlight_feature: z
    .string()
    .describe("【突出特点】这张图最抓人眼球的一个视觉锚点。"),
});

const VisualAnalysisReportSchema = z.object({
  user_raw_intent: z.string().describe("用户的原始文字诉求摘要。"),
  analyzed_images: z
    .array(ImageAnalysisSchema)
    .describe("包含所有输入图片的详细分析列表。"),
  overall_visual_summary: z
    .string()
    .describe("综合所有图片得出的整体视觉基调总结。"),
});

const ContentStrategyBriefSchema = z.object({
  input_evaluation: z
    .string()
    .describe("【素材评估】基于用户诉求和图片质量的综合评价，指出优势和劣势，并给出修图建议。"),
  target_audience_persona: z
    .string()
    .describe("【目标受众画像】采用反漏斗模型，定义最核心的细分人群。"),
  core_pain_point: z
    .string()
    .describe("【核心痛点/诉求】受众最想解决的问题或最渴望的情绪价值。"),
  suggested_title: z
    .string()
    .describe("【建议标题】痛点场景 + 情绪/利益钩子 + 核心人群标签，包含标点和 Emoji，20 字以内。"),
  content_outline: z
    .array(z.string())
    .describe("【笔记大纲】正文结构安排：场景引入、沉浸式体验、干货植入、结尾强引导。"),
  engagement_strategy: z
    .string()
    .describe("【点赞评论诱饵】设计具体策略来引发评论互动。"),
  retention_strategy: z
    .string()
    .describe("【收藏诱饵】提供具体实用价值让用户收藏。"),
  seo_keywords: z
    .array(z.string())
    .length(3)
    .describe("【关键词布局】基于 KFS 策略，列出 3 个必须埋入文案的长尾关键词。"),
});

type VisualAnalysisReport = z.infer<typeof VisualAnalysisReportSchema>;
type ContentStrategyBrief = z.infer<typeof ContentStrategyBriefSchema>;
```

---

## 8. Agent systemPrompt 设计

lesson1 已经有一个成熟的 `contentStrategistSystemPrompt`，lesson2 可以在其基础上修改，重点增加“Task 契约意识”。

### 8.1 推荐 systemPrompt

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

**思维心法**：
1. 反漏斗定位：找到产品最 "痛" 的细分场景。例如：不是 "喝水"，而是 "独处时的精神避难所"
2. 设计钩子：互动钩子引发争议或共鸣；价值锚点用干货点诱导收藏
3. 关键词布局：指定 3 个核心长尾词，为搜索流量复活做准备
4. 分步骤慢思考：你必须使用 Save_Intermediate_Product_Tool 工具保存中间结果

**行为边界**：
- 只负责输出策略大纲 Brief
- 绝对不要撰写最终正文
- 绝对不要撰写完整示例文案
- 不允许委派给其他 Agent
- 所有思考过程、工具调用和最终输出都必须使用中文

**结构化输出要求**：
最终结果必须符合 ContentStrategyBrief 结构。
不要在结构化结果之外额外输出无关解释。
`.trim();
```

注意：

- 工具名称必须写 `Save_Intermediate_Product_Tool`；
- 不要写 `save_intermediate_result`，否则和项目已有工具不一致；
- 保留 lesson1 的教学语言和概念体系。

---

## 9. Task 输入设计

CrewAI 原写法是：

```python
crew.kickoff(inputs={"visual_report": visual_report.model_dump_json()})
```

在 lesson2 中，建议定义一个函数生成 user message：

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
- 报告包含：user_raw_intent、analyzed_images、overall_visual_summary
- 策略要符合小红书平台的算法特点
- 所有输出必须使用中文
`.trim();
}
```

这个函数对应 CrewAI 的：

```python
Task(description="""... {visual_report} ...""")
```

---

## 10. createAgent 结构化输出设计

`lesson1.ts` 使用：

```ts
const contentStrategist = createAgent({
  model: llm,
  tools: [saveIntermediateProductTool],
  systemPrompt: contentStrategistSystemPrompt,
});
```

lesson2 建议升级为：

```ts
const contentStrategist = createAgent({
  model: llm,
  tools: [saveIntermediateProductTool],
  systemPrompt: contentStrategistSystemPrompt,
  responseFormat: ContentStrategyBriefSchema,
});
```

这里的 `responseFormat` 对应 CrewAI 的：

```python
output_pydantic=ContentStrategyBrief
```

最终调用：

```ts
const result = await contentStrategist.invoke({
  messages: [
    {
      role: "user",
      content: createContentStrategyTaskMessage(visualReport),
    },
  ],
});

const strategy = result.structuredResponse;
```

---

## 11. 是否还需要两阶段架构？

在当前项目和课程阶段，**不建议 lesson2 一开始使用两阶段架构**。

之前的两阶段方案是：

```text
Agent 先生成草稿
        ↓
另一个 structured chain 再整理结构化输出
```

它适合生产场景，但不适合当前 lesson2 的教学主线。

原因：

1. `lesson1.ts` 已经选择了 `createAgent`；
2. LangChain 当前 `createAgent` 原生支持 `responseFormat`；
3. CrewAI 示例本身就是在讲 `Task.output_pydantic`，不是在讲复杂 pipeline；
4. 两阶段会让学习者误以为结构化输出必须拆成两个模型调用；
5. 当前更重要的是建立映射：

```text
CrewAI output_pydantic  ≈  LangChain createAgent responseFormat
```

因此建议：

```text
lesson2：单 Agent + responseFormat
后续 lesson：如果遇到模型结构化不稳定，再引入两阶段修复方案
```

---

## 12. 完整 lesson2 示例设计

下面是推荐的 `src/course_01/lesson2.ts` 结构。

```ts
/**
 从“自然语言输出” -> “契约驱动输出”

 CrewAI 中 Task 的三个关键点：
 - description：任务说明，告诉 Agent 要做什么
 - expected_output：期望产物，告诉 Agent 最终应该交付什么
 - output_pydantic：输出契约，让最终结果必须符合指定结构

 在 LangChain 中，对应为：
 - user message：承载 Task description 和输入变量
 - systemPrompt：承载 Agent 的 role / goal / backstory / 行为边界
 - responseFormat：承载结构化输出契约，对应 CrewAI 的 output_pydantic
*/

import { createAgent } from "langchain";
import * as z from "zod";
import { AliyunQwenChatModel } from "../llm/aliyun-qwen-chat-model";
import { saveIntermediateProductTool } from "../tools/intermediate-tool";

const ImageAnalysisSchema = z.object({
  file_name: z.string().describe("图片文件名或 ID。"),
  subject_description: z
    .string()
    .describe("【主体内容】客观描述画面中的核心物体、人物或场景。"),
  atmosphere_vibe: z
    .string()
    .describe("【风格氛围】用形容词描述画面的情绪价值。"),
  visual_details: z
    .array(z.string())
    .describe("【细节点列表】列出画面中容易被忽略但具象的元素。"),
  image_quality_score: z
    .string()
    .describe("【质量评价】1-10 分打分，基于构图、光线和清晰度给出打分原因。"),
  highlight_feature: z
    .string()
    .describe("【突出特点】这张图最抓人眼球的一个视觉锚点。"),
});

const VisualAnalysisReportSchema = z.object({
  user_raw_intent: z.string().describe("用户的原始文字诉求摘要。"),
  analyzed_images: z
    .array(ImageAnalysisSchema)
    .describe("包含所有输入图片的详细分析列表。"),
  overall_visual_summary: z
    .string()
    .describe("综合所有图片得出的整体视觉基调总结。"),
});

const ContentStrategyBriefSchema = z.object({
  input_evaluation: z
    .string()
    .describe("【素材评估】基于用户诉求和图片质量的综合评价，指出优势和劣势，并给出修图建议。"),
  target_audience_persona: z
    .string()
    .describe("【目标受众画像】采用反漏斗模型，定义最核心的细分人群。"),
  core_pain_point: z
    .string()
    .describe("【核心痛点/诉求】受众最想解决的问题或最渴望的情绪价值。"),
  suggested_title: z
    .string()
    .describe("【建议标题】痛点场景 + 情绪/利益钩子 + 核心人群标签，包含标点和 Emoji，20 字以内。"),
  content_outline: z
    .array(z.string())
    .describe("【笔记大纲】正文结构安排：场景引入、沉浸式体验、干货植入、结尾强引导。"),
  engagement_strategy: z
    .string()
    .describe("【点赞评论诱饵】设计具体策略来引发评论互动。"),
  retention_strategy: z
    .string()
    .describe("【收藏诱饵】提供具体实用价值让用户收藏。"),
  seo_keywords: z
    .array(z.string())
    .length(3)
    .describe("【关键词布局】基于 KFS 策略，列出 3 个必须埋入文案的长尾关键词。"),
});

type VisualAnalysisReport = z.infer<typeof VisualAnalysisReportSchema>;
type ContentStrategyBrief = z.infer<typeof ContentStrategyBriefSchema>;

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

**思维心法**：
1. 反漏斗定位：找到产品最 "痛" 的细分场景。例如：不是 "喝水"，而是 "独处时的精神避难所"
2. 设计钩子：互动钩子引发争议或共鸣；价值锚点用干货点诱导收藏
3. 关键词布局：指定 3 个核心长尾词，为搜索流量复活做准备
4. 分步骤慢思考：你必须使用 Save_Intermediate_Product_Tool 工具保存中间结果

**行为边界**：
- 只负责输出策略大纲 Brief
- 绝对不要撰写最终正文
- 绝对不要撰写完整示例文案
- 不允许委派给其他 Agent
- 所有思考过程、工具调用和最终输出都必须使用中文

**结构化输出要求**：
最终结果必须符合 ContentStrategyBrief 结构。
不要在结构化结果之外额外输出无关解释。
`.trim();

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

const visualReport: VisualAnalysisReport = {
  user_raw_intent: "想卖这个墨绿色马克杯，主打独居女生市场，强调氛围感和情绪价值",
  analyzed_images: [
    {
      file_name: "cup_001.jpg",
      subject_description: "一只带有金色裂纹纹理的墨绿色陶瓷马克杯，放置在木质书桌上",
      atmosphere_vibe: "静谧、复古、松弛感",
      visual_details: ["书页上的光斑", "杯口边缘的咖啡渍", "背景虚化的绿植", "暖色调的台灯光线"],
      image_quality_score: "6分，构图有些杂乱，光线有些暗，清晰度一般",
      highlight_feature: "金色裂纹纹理在暖光下的反光效果",
    },
    {
      file_name: "cup_002.jpg",
      subject_description: "同一只马克杯的特写，展示杯身的细节和质感",
      atmosphere_vibe: "精致、温暖、治愈",
      visual_details: ["陶瓷表面的细腻质感", "墨绿色与金色的对比", "杯内残留的咖啡液", "柔和的侧光"],
      image_quality_score: "8分，构图、光线和清晰度都很好，特写的鱼眼效果稍微有点变形",
      highlight_feature: "墨绿色与金色裂纹的强烈视觉对比",
    },
    {
      file_name: "cup_003.jpg",
      subject_description: "一个长发女生的背影，坐在书桌边，手上拿着一个马克杯",
      atmosphere_vibe: "慵懒、放松、治愈",
      visual_details: ["书桌上的台灯", "书桌上的绿植", "书桌上的咖啡杯", "书桌上的笔记本电脑"],
      image_quality_score: "6分，背景有些杂乱，主体不突出，光线比较平",
      highlight_feature: "女生的背影和书桌上的咖啡杯",
    },
  ],
  overall_visual_summary:
    "整体素材偏向低饱和度的复古风格，色调温暖柔和，适合营造'独处时光'和'精神避难所'的情绪氛围。图片质量较高，构图简洁，但缺乏产品细节展示和场景多样性。",
};

function createContentStrategyTaskMessage(report: VisualAnalysisReport) {
  return `
**任务要求**：
1. 仔细分析视觉报告中的用户意图、图片质量和整体风格
2. 基于 CES 算法和反漏斗模型，制定精准的内容策略
3. 策略要具体可执行，不能泛泛而谈
4. 使用 Save_Intermediate_Product_Tool 工具保存中间思考过程
5. 最终输出必须符合 ContentStrategyBrief 结构

视觉分析报告如下：
${JSON.stringify(report, null, 2)}

**重要提示**：
- 必须基于输入的视觉分析报告进行分析
- 报告包含：user_raw_intent、analyzed_images、overall_visual_summary
- 策略要符合小红书平台的算法特点
- 所有输出必须使用中文
`.trim();
}

const parsedVisualReport = VisualAnalysisReportSchema.parse(visualReport);

const result = await contentStrategist.invoke({
  messages: [
    {
      role: "user",
      content: createContentStrategyTaskMessage(parsedVisualReport),
    },
  ],
});

const strategy = result.structuredResponse as ContentStrategyBrief;

console.log("\n" + "=".repeat(80));
console.log("结构化输出:");
console.log("=".repeat(80));
console.log(JSON.stringify(strategy, null, 2));

console.log("\n" + "=".repeat(80));
console.log("字段访问示例:");
console.log("=".repeat(80));
console.log("素材评估:", strategy.input_evaluation);
console.log("目标受众:", strategy.target_audience_persona);
console.log("建议标题:", strategy.suggested_title);
```

---

## 13. 如果想保留 lesson1 的 streaming 教学风格

`lesson1.ts` 使用的是：

```ts
const stream = await contentStrategist.stream(
  {
    messages: [...],
  },
  {
    streamMode: "values",
  },
);
```

lesson2 也可以提供一个 streaming 版本，用来观察工具调用过程。

但是要注意：

```text
stream 更适合观察 Agent 执行过程
invoke 更适合读取最终 structuredResponse
```

因此推荐 lesson2 主流程用 `invoke`，补充演示再用 `stream`。

### 13.1 streaming 观察版本

```ts
const stream = await contentStrategist.stream(
  {
    messages: [
      {
        role: "user",
        content: createContentStrategyTaskMessage(parsedVisualReport),
      },
    ],
  },
  {
    streamMode: "values",
  },
);

for await (const chunk of stream) {
  const lastMessage = chunk.messages.at(-1);

  console.log("\n==============================");
  console.log("最新消息类型:", lastMessage?.getType?.());
  console.log("最新消息内容:", lastMessage?.content);

  if ("tool_calls" in (lastMessage ?? {})) {
    // @ts-ignore
    console.log("工具调用:", lastMessage?.tool_calls);
  }

  if (chunk.structuredResponse) {
    console.log("结构化输出:", chunk.structuredResponse);
  }
}
```

建议在课程里说明：

- `stream` 观察的是执行轨迹；
- `invoke` 获取的是最终结果；
- 如果目标是稳定拿结构化数据，优先用 `invoke`。

---

## 14. 依赖调整

当前 `package.json` 已有：

```json
{
  "dependencies": {
    "@langchain/core": "^1.1.48",
    "@langchain/openai": "^1.4.7",
    "langchain": "^1.4.4"
  }
}
```

但 `src/tools/intermediate-tool.ts` 已经直接使用：

```ts
import * as z from "zod";
```

lesson2 也会直接使用 `zod`。

因此建议把 `zod` 显式加入直接依赖：

```bash
bun add zod
```

这不是因为项目当前一定不能运行，而是因为：

```text
只要源码直接 import 某个包，就应该把它列为直接依赖，而不是依赖 transitive dependency。
```

---

## 15. 运行方式

按照项目约定，使用 Bun：

```bash
bun src/course_01/lesson2.ts
```

如果要类型检查：

```bash
bun run check
```

---

## 16. 验收标准

lesson2 完成后，应满足：

```text
[ ] 继续使用 createAgent，而不是引入另一套 AgentExecutor 写法
[ ] 继续使用 AliyunQwenChatModel，而不是新建 ChatOpenAI/Qwen wrapper
[ ] 继续使用 saveIntermediateProductTool
[ ] Prompt 中工具名写的是 Save_Intermediate_Product_Tool
[ ] 使用 Zod 定义 ImageAnalysis / VisualAnalysisReport / ContentStrategyBrief
[ ] 使用 responseFormat: ContentStrategyBriefSchema 对应 CrewAI output_pydantic
[ ] 使用 agent.invoke({ messages }) 对应 CrewAI crew.kickoff(inputs)
[ ] 从 result.structuredResponse 读取最终结构化结果
[ ] 保留 lesson1 的教学风格和注释风格
[ ] 可以通过 strategy.suggested_title 等字段类型安全访问结果
```

---

## 17. 新方案和旧方案的关键差异

| 维度 | 旧文档方案 | 参考 lesson1 后的新方案 |
|---|---|---|
| Agent 构造 | `createToolCallingAgent` / `AgentExecutor` | `createAgent` |
| 模型接入 | `ChatOpenAI` + DashScope compatible API | `AliyunQwenChatModel` |
| 工具 | 新建 `intermediateTool` | 复用 `saveIntermediateProductTool` |
| 工具名称 | `save_intermediate_result` | `Save_Intermediate_Product_Tool` |
| 结构化输出 | `model.withStructuredOutput(...)` | `createAgent({ responseFormat })` |
| 文件组织 | 拆成 schemas / agents / chains | lesson2 单文件优先 |
| 教学主线 | 更偏生产 pipeline | 更贴合 lesson1 的课程递进 |

---

## 18. 一句话总结

参考 `src/course_01/lesson1.ts` 后，lesson2 应该被设计成：

```text
用 Zod 定义 Task 输入输出契约
        +
用 createAgent 复用 lesson1 的 Agent 风格
        +
用 responseFormat 映射 CrewAI 的 output_pydantic
        +
用 result.structuredResponse 读取结构化结果
```

这比“两阶段 Chain”更适合作为当前课程的第二课，因为它能最直接地回答：

```text
CrewAI 的 Task(output_pydantic=...) 在 LangChain TypeScript 中应该怎么表达？
```

答案就是：

```ts
const agent = createAgent({
  model: llm,
  tools: [saveIntermediateProductTool],
  systemPrompt,
  responseFormat: ContentStrategyBriefSchema,
});

const result = await agent.invoke({ messages });
console.log(result.structuredResponse);
```
