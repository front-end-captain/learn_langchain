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

// 单张图片的深度分析详情
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
// 视觉与意图分析报告 - 作为下游任务的输入上下文
export const VisualAnalysisReportSchema = z.object({
  userRawIntent: z.string().describe("用户的原始文字诉求摘要。"),
  analyzedImages: z
    .array(ImageAnalysisSchema)
    .describe("包含所有输入图片的详细分析列表。"),
  overallVisualSummary: z
    .string()
    .describe("综合所有图片得出的整体视觉基调总结。"),
});
// 爆款内容策划简报 - Strategist Agent 的交付物
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
  contentOutline: z.array(z.string()).describe("【笔记大纲】正文结构安排。"),
  engagementStrategy: z
    .string()
    .describe("【点赞评论诱饵】设计具体策略来引发评论互动。"),
  retentionStrategy: z
    .string()
    .describe("【收藏诱饵】提供具体实用价值让用户点击收藏。"),
  seoKeywords: z
    .array(z.string())
    .length(3)
    .describe(
      "【关键词布局】基于 KFS 策略，列出 3 个必须埋入文案的长尾关键词。",
    ),
});
// 文案撰写产出 - Writer Agent 的交付物
export const CopywritingOutputSchema = z.object({
  title: z
    .string()
    .describe("【笔记标题】完整的小红书笔记标题，包含 Emoji 和标点符号。"),
  content: z.string().describe("【笔记正文】完整的小红书笔记正文内容。"),
  pictureList: z
    .array(ImageAnalysisSchema)
    .describe("【图片列表】根据视觉元素描述筛选合适的图片并排序。"),
});
// 搜索优化后的笔记报告 - SEO Agent 的最终交付物
export const SEOOptimizedNoteReportSchema = z.object({
  optimizationSummary: z
    .string()
    .describe("【优化总结】说明本次 SEO 优化的重点和改进点。"),
  optimizedTitle: z
    .string()
    .describe("【优化后的标题】在原始标题基础上进行 SEO 优化。"),
  optimizedContent: z.string().describe("【优化后的正文】自然融入长尾关键词。"),
  optimizedPictureList: z
    .array(ImageAnalysisSchema)
    .describe("【优化后的图片列表】根据优化后的正文筛选并排序。"),
  tags: z
    .array(z.string())
    .min(5)
    .max(8)
    .describe("基于 SEO 生成的 5-8 个标签。"),
});

type VisualAnalysisReport = z.infer<typeof VisualAnalysisReportSchema>;
type ContentStrategyBrief = z.infer<typeof ContentStrategyBriefSchema>;
type CopywritingOutput = z.infer<typeof CopywritingOutputSchema>;
type SEOOptimizedNoteReport = z.infer<typeof SEOOptimizedNoteReportSchema>;

// 视觉与意图分析报告
const visualReport: VisualAnalysisReport = {
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
  const strategyBrief = ContentStrategyBriefSchema.parse(
    strategyResult.structuredResponse,
  );

  const copywritingResult = await contentWriter.invoke({
    messages: [
      {
        role: "user",
        content: createCopywritingTaskMessage(
          parsedVisualReport,
          strategyBrief,
        ),
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
