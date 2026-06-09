import { createAgent } from "langchain";
import * as z from "zod";
import {
  createAgentUpdateEvent,
  createStructuredResponseEvent,
  createToolCallsEvent,
  getToolCalls,
  type AgentStreamEvent,
  type AgentStreamEventHandler,
} from "../../helper/agent-stream";
import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model";
import { saveIntermediateProductTool } from "../../tools/intermediate-tool";

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
    .describe("【质量评价】1-10 分打分，基于构图、光线和清晰度给出打分原因。"),
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
    .describe(
      "【素材评估】基于用户诉求和图片质量的综合评价，指出优势和劣势，并给出修图建议。",
    ),
  targetAudiencePersona: z
    .string()
    .describe("【目标受众画像】采用反漏斗模型，定义最核心的细分人群。"),
  corePainPoint: z
    .string()
    .describe("【核心痛点/诉求】受众最想解决的问题或最渴望的情绪价值。"),
  suggestedTitle: z
    .string()
    .describe(
      "【建议标题】痛点场景 + 情绪/利益钩子 + 核心人群标签，20 字以内。",
    ),
  contentOutline: z
    .array(z.string())
    .describe(
      "【笔记大纲】正文结构安排：场景引入、沉浸式体验、干货植入、结尾引导。",
    ),
  engagementStrategy: z
    .string()
    .describe("【点赞评论诱饵】设计具体策略来引发评论互动。"),
  retentionStrategy: z
    .string()
    .describe("【收藏诱饵】提供具体实用价值，诱导用户收藏。"),
  seoKeywords: z
    .array(z.string())
    .length(3)
    .describe(
      "【关键词布局】基于 KFS 策略，列出 3 个必须埋入文案的长尾关键词。",
    ),
});

export type VisualAnalysisReport = z.infer<typeof VisualAnalysisReportSchema>;
export type ContentStrategyBrief = z.infer<typeof ContentStrategyBriefSchema>;
export type Lesson2StreamEvent = AgentStreamEvent<ContentStrategyBrief>;

export const defaultVisualReport: VisualAnalysisReport = {
  userRawIntent: "想卖这个墨绿色马克杯，主打独居女生市场，强调氛围感和情绪价值",
  analyzedImages: [
    {
      fileName: "cup_001.jpg",
      subjectDescription:
        "一只带有金色裂纹纹理的墨绿色陶瓷马克杯，放置在木质书桌上",
      atmosphereVibe: "静谧、复古、松弛感",
      visualDetails: [
        "书页上的光斑",
        "杯口边缘的咖啡渍",
        "背景虚化的绿植",
        "暖色调的台灯光线",
      ],
      imageQualityScore: "6分，构图有些杂乱，光线有些暗，清晰度一般",
      highlightFeature: "金色裂纹纹理在暖光下的反光效果",
    },
    {
      fileName: "cup_002.jpg",
      subjectDescription: "同一只马克杯的特写，展示杯身的细节和质感",
      atmosphereVibe: "精致、温暖、治愈",
      visualDetails: [
        "陶瓷表面的细腻质感",
        "墨绿色与金色的对比",
        "杯内残留的咖啡液",
        "柔和的侧光",
      ],
      imageQualityScore:
        "8分，构图、光线和清晰度都很好，特写的鱼眼效果稍微有点变形",
      highlightFeature: "墨绿色与金色裂纹的强烈视觉对比",
    },
    {
      fileName: "cup_003.jpg",
      subjectDescription: "一个长发女生的背影，坐在书桌边，手上拿着一个马克杯",
      atmosphereVibe: "慵懒、放松、治愈",
      visualDetails: [
        "书桌上的台灯",
        "书桌上的绿植",
        "书桌上的咖啡杯",
        "书桌上的笔记本电脑",
      ],
      imageQualityScore: "6分，背景有些杂乱，主体不突出，光线比较平",
      highlightFeature: "女生的背影和书桌上的咖啡杯",
    },
  ],
  overallVisualSummary:
    "整体素材偏向低饱和度的复古风格，色调温暖柔和，适合营造'独处时光'和'精神避难所'的情绪氛围。图片质量较高，构图简洁，但缺乏产品细节展示和场景多样性。",
};

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

export function createContentStrategyTaskMessage(report: VisualAnalysisReport) {
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
- 报告包含：userRawIntent、analyzedImages、overallVisualSummary
- 策略要符合小红书平台的算法特点
- 所有输出必须使用中文
`.trim();
}

export function createContentStrategistAgent() {
  const llm = new AliyunQwenChatModel({
    model: "qwen3.7-plus",
    apiKey: process.env["QWEN_API_KEY"] ?? "",
    apiBase: process.env["QWEN_API_BASE"] ?? "",
  });

  return createAgent({
    model: llm,
    tools: [saveIntermediateProductTool],
    systemPrompt: contentStrategistSystemPrompt,
    responseFormat: ContentStrategyBriefSchema,
  });
}

export async function runLesson2WithStream(
  report: VisualAnalysisReport,
  onEvent?: AgentStreamEventHandler<ContentStrategyBrief>,
): Promise<ContentStrategyBrief> {
  const parsedReport = VisualAnalysisReportSchema.parse(report);
  const contentStrategist = createContentStrategistAgent();
  const stream = await contentStrategist.stream(
    {
      messages: [
        {
          role: "user",
          content: createContentStrategyTaskMessage(parsedReport),
        },
      ],
    },
    {
      streamMode: "values",
    },
  );

  let finalBrief: ContentStrategyBrief | undefined;

  for await (const chunk of stream) {
    const lastMessage = chunk.messages.at(-1);
    onEvent?.(createAgentUpdateEvent(lastMessage));

    const toolCalls = getToolCalls(lastMessage);
    if (toolCalls.length > 0) {
      onEvent?.(createToolCallsEvent(toolCalls));
    }

    if (chunk.structuredResponse) {
      finalBrief = ContentStrategyBriefSchema.parse(chunk.structuredResponse);
      onEvent?.(createStructuredResponseEvent(finalBrief));
    }
  }

  if (!finalBrief) {
    throw new Error("未获取到结构化输出 structuredResponse");
  }

  return finalBrief;
}
