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

export const ContentStrategySchema = z.object({
  input_evaluation: z
    .string()
    .describe("基于用户诉求和图片素材的综合评估，指出优势、劣势和修图建议。"),
  target_audience_persona: z
    .string()
    .describe("目标受众画像：年龄、职业、生活状态、心理诉求等。"),
  core_pain_point: z.string().describe("核心痛点 / 诉求。"),
  suggested_title: z
    .string()
    .describe(
      "建议标题，遵循【痛点场景 + 情绪/利益钩子 + 群体标签】并包含 Emoji。",
    ),
  content_outline: z
    .array(z.string())
    .describe("笔记大纲：如场景引入、体验描写、干货植入、结尾引导等。"),
  engagement_strategy: z
    .string()
    .describe("互动策略：如何设计评论诱饵 / 点赞引导等。"),
  retention_strategy: z
    .string()
    .describe("收藏策略：为用户提供收藏理由的具体做法。"),
  seo_keywords: z
    .array(z.string())
    .describe("3 个左右必须埋入文案的长尾关键词列表。"),
});

export type ContentStrategy = z.infer<typeof ContentStrategySchema>;

function createContentStrategyTaskMessage(
  ideaText: string,
  visual_report: string,
  edit_report: string,
) {
  return `
你将基于用户创作意图、多张图片的视觉分析报告以及编辑方案概要，输出一份可直接指导爆款笔记创作的内容策略简报。

1）用户的原始创作意图 user_raw_intent（字符串）：
   ${ideaText}

2）多张图片的视觉分析报告 visual_report（JSON格式）：
   ${visual_report}

3）图片编辑方案概要 edit_report（JSON格式）：
   ${edit_report}

请仔细阅读上述信息，基于用户意图和图片分析结果，制定符合小红书平台增长逻辑的内容策略简报。
特别重要：
- 必须严格基于用户提供的创作意图和图片分析结果，不得自行编造或使用示例数据。
- 如果用户意图是"地中海饮食减脂"，则策略应围绕地中海饮食相关内容，而不是其他主题（如咖啡机）。
- 所有策略建议必须与用户意图和图片内容高度相关。
- 请完整阅读visual_report和edit_report中的内容，确保策略与图片实际内容一致。
- 使用 Save_Intermediate_Product_Tool 工具保存中间思考过程

**期望输出：**
一个完整的 ContentStrategy 结构化输出。
  `.trim();
}

const contentStrategySystemPrompt = `
你是: 资深小红书增长策略专家
你的目标: 基于用户意图、多张图片的视觉分析与编辑方案，制定一份可以直接指导爆款笔记创作的内容策略简报。
你的背景:
**一、身份与背景**
你曾是国内顶级 MCN 机构的内容总监，负责过多个品类在小红书上的冷启动与规模化增长项目。
你深谙小红书 2025 年的算法变迁，对平台在「互动质量」「内容相关性」「账号画像」等维度的评估逻辑有长期一线实践经验。
你不再相信简单的流量铺张，而是坚信「价值耕耘」和「KFS 闭环」，习惯从长期复利和可持续增长的视角看待每一次内容投入。

**二、关键知识与理论**
- CES 评分机制：理解评论 (4 分) > 收藏 (1 分) > 点赞 (1 分) 的权重差异，习惯优先设计能激发评论与收藏的互动结构。
- 反漏斗模型 (Anti-Funnel)：坚持「窄即是宽」，先锁定最精准的核心人群与细分场景，再在此基础上做可控的破圈尝试。
- KFS 闭环思维：围绕 Keywords（关键词）、Feed（内容供给）、Search（搜索需求）构建可持续的增长循环，而不是一次性爆款。
- 语义工程与标题工程：熟练运用【痛点场景】+【解决方案/情绪钩子】+【群体标签】的组合，兼顾搜索可见度与情绪点击动机。
- 冷启动池穿透策略：理解 L1 冷启动池的互动门槛和行为特征，善于通过高质量互动驱动内容快速上岸。

**三、工作方法与行为习惯**
- 先定人群再定内容：任何策略设计都会先锁定目标人群与生活场景，而不是从产品卖点单向出发。
- 以「评论问题」反推内容结构：习惯从「我想让用户在评论区说什么」倒推标题钩子与正文结构设计。
- 强调长尾词布局：每个策略默认会为产品指定 3 个以上核心长尾词，兼顾搜索复活与持续流量。
- 保持「分步骤慢思考」：不一次性给出结论，而是通过中间推理步骤逐层收窄策略范围（可使用 Save_Intermediate_Product_Tool 保存中间结果）。
- 与下游紧密对接：输出的策略大纲会明确标记哪些内容交由文案、哪些交由视觉与图片编辑处理，减少执行歧义。

**四、行为边界（不做什么）**
- 只负责输出内容策略大纲（Brief），不会撰写最终的正文、标题或示例文案，这属于内容编辑的职责。
- 不直接给出具体 SEO 操作方案（如关键词密度调整），只会在策略层面指出搜索方向，由 SEO 专家落地。
- 不对单条内容的数据做「算命式」预测，所有判断建立在明确假设与可复用方法之上。
- 不为了短期曝光而牺牲账号长期人设与内容质量，反对「为数据放弃价值」的短视行为。
- 所有思考过程、工具调用和最终输出都必须使用中文。
`;

export async function createcontentStrategyTask(
  ideaText: string,
  visual_report: string,
  edit_report: string,
) {
  const agent = createAgent({
    model: llm,
    tools: [saveIntermediateProductTool],
    systemPrompt: contentStrategySystemPrompt,
    responseFormat: ContentStrategySchema,
  });

  return await agent.invoke({
    messages: [
      {
        role: "user",
        content: createContentStrategyTaskMessage(
          ideaText,
          visual_report,
          edit_report,
        ),
      },
    ],
  });
}
