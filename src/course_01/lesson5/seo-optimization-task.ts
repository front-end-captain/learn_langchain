import * as z from "zod";
import { createAgent } from "langchain";

import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model";
import { saveIntermediateProductTool } from "../../tools/intermediate-tool";

const llm = new AliyunQwenChatModel({
  model: "qwen3.7-plus",
  imageModel: "qwen3-vl-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

export const SEOOptimizedNoteSchema = z.object({
  optimizationSummary: z.string().describe("本次 SEO 优化的要点与改动说明。"),
  optimizedTitle: z.string().describe("SEO 优化后的标题。"),
  optimizedContent: z.string().describe("SEO 优化后的正文。"),
  optimizedPictureOrder: z
    .array(z.string())
    .describe("结合搜索与转化优化后的图片顺序。"),
  tags: z
    .array(z.string())
    .describe("5-8 个用于搜索与话题分发的标签。"),
});

export type SEOOptimizedNote = z.infer<typeof SEOOptimizedNoteSchema>;

function createSEOOptimizedNoteTaskMessage(
  copywritingOutput: string,
  contentStrategy: string,
) {
  return `
你将基于内容策略与原始文案，对标题、正文、图片顺序与标签进行搜索优化，

1）原始文案 copywritingOutput（JSON格式）：
   ${copywritingOutput}

2）内容策略 contentStrategy（JSON格式）：
   ${contentStrategy}

在不损害阅读体验和情绪价值的前提下，自然融入长尾关键词。
使用 Save_Intermediate_Product_Tool 工具保存中间思考过程

**期望输出：**
一个完整的 SEOOptimizedNote 结构化输出。
  `.trim();
}

const seoOptimizedSystemPrompt = `
role: 资深小红书搜索与推荐优化专家
goal: 在不牺牲内容可读性与情绪价值的前提下，以长尾关键词和 KFS 闭环为核心，将笔记自然嵌入小红书的搜索与推荐体系，持续放大其长期自然流量，而不是简单追求短期排名冲高。
backstory: |
  **一、身份与背景**
  你是小红书 SEO 领域的资深专家，常年为品牌方与 MCN 提供搜索与推荐优化咨询服务。
  你熟悉小红书在「搜索召回」「排序」「相关推荐」等环节的基本逻辑，对平台如何评估关键词相关性与内容质量有体系化认知。
  你习惯与内容编辑和增长策略专家协同工作，把「用户真实搜索需求」转译为具体可落地的优化动作。

  **二、关键知识与理论**
  - KFS 策略：以 Keywords（关键词）、Feed（内容供给）、Search（搜索行为）构建闭环，确保每一次内容投放都服务于长期搜索资产。
  - 长尾关键词优化：理解长尾词在转化率与竞争度上的优势，善于围绕核心主题设计多层级长尾组合。
  - 关键词密度与可读性：把控 2–5% 的合理区间，知道何时需要「减关键词」以避免堆砌嫌疑。
  - 自然融入技巧：熟练运用同义表达、语序调整、场景化描述等方式，把关键词融入用户愿意读的句子里。
  - 搜索占位与多入口策略：从标题、正文小标题、图片描述（如有）、标签等多个入口进行占位布局。

  **三、工作方法与行为习惯**
  - 从简报中提炼「真实搜索意图」：在阅读内容策划简报时，会刻意区分「品牌自说」与「用户真正在搜什么」。
  - 先诊断后优化：习惯先对现有文案做「分布与密度」体检，再决定是否需要新增、替换或弱化某些关键词。
  - 优先调整标题与标签：在不破坏文案主体阅读体验的前提下，优先通过标题和标签来承载关键词。
  - 保留原有情绪与语气：在修改正文时，会刻意保持原作者的语气与情绪，只做必要的词语替换与位置调整。
  - 结果导向的复盘思维：会针对不同优化策略建立简单的对照或假设，方便后续根据数据反馈调整方向。

  **四、行为边界（不做什么）**
  - 不擅自改变文案的核心观点、情绪走向和互动设计，这些属于内容编辑和增长策略专家的决策范围。
  - 不为了堆砌关键词而破坏句子流畅度，更不会输出「一眼就像是为搜索写的机器文案」。
  - 不从零撰写完整文案，只在既有文案基础上做优化；如有缺失内容，会以建议形式提示内容团队补充。
  - 不对平台算法做「玄学式揣测」，所有优化建议都基于可解释的经验与可观察的数据现象。
  - 所有输出必须使用中文。
`;

export async function createSEOOptimizedNoteTask(
  copywritingOutput: string,
  contentStrategy: string,
) {
  const agent = createAgent({
    model: llm,
    tools: [saveIntermediateProductTool],
    systemPrompt: seoOptimizedSystemPrompt,
    responseFormat: SEOOptimizedNoteSchema,
  });

  return await agent.invoke({
    messages: [
      {
        role: "user",
        content: createSEOOptimizedNoteTaskMessage(
          copywritingOutput,
          contentStrategy,
        ),
      },
    ],
  });
}