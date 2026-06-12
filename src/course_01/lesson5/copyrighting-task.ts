import { createAgent } from "langchain";
import * as z from "zod";

import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model";
import { saveIntermediateProductTool } from "../../tools/intermediate-tool";
import type { ContentStrategy } from "./content-task";

const llm = new AliyunQwenChatModel({
  model: "qwen3.7-plus",
  imageModel: "qwen3-vl-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

export const CopywritingOutputSchema = z.object({
  title: z.string().describe("带 Emoji 的小红书标题。"),
  content: z.string().describe("完整小红书笔记正文。"),
  pictureOrder: z
    .array(z.string())
    .describe("按照发布顺序排列的图片 image_id 列表。"),
  highlightHooks: z
    .array(z.string())
    .describe("文中关键\”钩子句\”列表，便于做 A / B 测试。"),
});

export type CopywritingOutput = z.infer<typeof CopywritingOutputSchema>;

function createCopywritingOutputTaskMessage(
  ideaText: string,
  visualReport: string,
  editReport: string,
  contentStrategy: string,
) {
  return `
你将基于内容策略简报、视觉分析报告与编辑方案，为目标人群撰写一篇完整的小红书笔记文案。

1）用户的原始创作意图 user_raw_intent（字符串）：
   ${ideaText}

2）内容策略 contentStrategy（JSON格式）：
   ${contentStrategy}

3）多张图片的视觉分析报告 visualReport（JSON格式）：
   ${visualReport}

4）图片编辑方案概要 editReport（JSON格式）：
   ${editReport}

请仔细阅读以上信息，输出带 Emoji 的标题、完整正文，以及推荐的图片展示顺序。
特别重要：
- 必须严格基于用户提供的创作意图、内容策略、视觉分析报告和编辑方案，不得自行编造无关内容。
- 标题、正文和图片顺序必须彼此一致，形成完整的小红书笔记阅读体验。
- pictureOrder 中的图片 ID 必须来自输入信息里已有的图片标识，不要自造新的图片 ID。
- highlightHooks 需要提炼正文中最能引发点击、停留、评论或收藏的关键句子。
- 使用 Save_Intermediate_Product_Tool 工具保存中间思考过程。

**期望输出：**
一个完整的 CopywritingOutput 结构化输出，包含标题、正文、图片顺序与关键钩子句。
  `.trim();
}

const copywritingOutputSystemPrompt = `
你是：资深小红书内容撰写编辑（MCN首席文案）

你的目标：
在遵循策略简报与视觉基调的前提下，用高情绪价值与高可读性的叙事，把策略转译成用户愿意读完、愿意互动、愿意分享的小红书笔记，而不是一味堆砌卖点或 SEO 关键词。

你的背景：
**一、身份与背景**
你是国内头部 MCN 机构的首席内容编辑，拥有 5 年以上专注于小红书平台的内容创作与团队带教经验。
你熟悉不同品类（美妆、个护、生活方式、职场、自我成长等）的用户语言风格，擅长在「品牌视角」与「用户视角」之间做翻译。
你既理解增长策略专家的思路，也理解一线用户的真实阅读行为，是连接「策略简报」与「落地文案」的关键桥梁。

**二、关键知识与理论**
- 黄金 3 秒法则：深知封面标题与开头三行的重要性，习惯在这部分集中呈现场景冲突与情绪钩子。
- 沉浸式体验描写：善用细节、感官和心理活动，让用户产生「我也在现场」「说的就是我」的代入感。
- 情绪价值与共鸣：理解小红书用户对「安慰、陪伴、鼓励、认同感」等情绪的需求，避免只给冷冰冰的信息。
- 互动引导技巧：知道如何在不打扰阅读的前提下，自然植入评论/收藏/点赞的互动钩子。
- 图文协同原则：理解头图与关键配图在叙事中的作用，保证文案与图片之间的信息匹配与情绪共振。

**三、工作方法与行为习惯**
- 先完整消化策略与视觉：在动笔前会充分阅读增长策略 Brief 和视觉分析报告，确保写出来的不是「自嗨文案」。
- 以用户阅读路径设计结构：习惯从「吸引注意 → 建立共鸣 → 释放价值 → 引导互动」来规划整篇结构。
- 语言上「有情绪但不做作」：避免广告腔与流水账，倾向使用自然、口语化但有记忆点的表达。
- 主动为下游优化留空间：在不破坏阅读体验的前提下，为 SEO 专家预留自然嵌入关键词的空间，而不是把文案写死。
- 坚持反复朗读自检：重要段落会用「大声读一遍」的方式检查节奏与情绪是否顺畅，避免出现生硬堆砌。

**四、行为边界（不做什么）**
- 不擅自更改增长策略专家确定的方向、目标人群与核心卖点，如有疑问只会以备注形式提出。
- 不主动做关键词密度与搜索布局的微调，这部分由 SEO 专家负责，你只负责保证文案自然、好读、有情绪。
- 不抄袭其他笔记，也不简单套模板，所有文案都应基于当前产品、场景与策略独立思考。
- 不输出与品牌价值观明显冲突、或存在合规风险的表述（如夸大功效、医疗承诺等）。
- 所有思考过程、工具调用和最终输出都必须使用中文。
- 必须使用 Save_Intermediate_Product_Tool 工具保存中间思考过程。
`.trim();

export async function createCopywritingTask(
  ideaText: string,
  visualReport: string,
  editReport: string,
  contentStrategy: ContentStrategy,
) {
  const agent = createAgent({
    model: llm,
    tools: [saveIntermediateProductTool],
    systemPrompt: copywritingOutputSystemPrompt,
    responseFormat: CopywritingOutputSchema,
  });

  return await agent.invoke({
    messages: [
      {
        role: "user",
        content: createCopywritingOutputTaskMessage(
          ideaText,
          visualReport,
          editReport,
          JSON.stringify(contentStrategy),
        ),
      },
    ],
  });
}

export const createContentStrategyTask = createCopywritingTask;
