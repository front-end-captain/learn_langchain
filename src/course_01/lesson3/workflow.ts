import { createAgent, ReactAgent } from "langchain";
import * as z from "zod";
import type { ToolCall } from "@langchain/core/messages/tool";
import {
  getToolCalls,
  maskBase64ImageContent,
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
    .describe("【质量评价】1-10 分打分，基于构图、光线和清晰度。"),
  highlightFeature: z
    .string()
    .describe("【突出特点】这张图最抓人眼球的一个视觉锚点。"),
});

export const VisualAnalysisReportSchema = z.object({
  userRawIntent: z.string().describe("用户的原始文字诉求摘要。"),
  analyzedImages: z.array(ImageAnalysisSchema),
  overallVisualSummary: z
    .string()
    .describe("综合所有图片得出的整体视觉基调总结。"),
});

export const ContentStrategyBriefSchema = z.object({
  inputEvaluation: z.string(),
  targetAudiencePersona: z.string(),
  corePainPoint: z.string(),
  suggestedTitle: z.string(),
  contentOutline: z.array(z.string()),
  engagementStrategy: z.string(),
  retentionStrategy: z.string(),
  seoKeywords: z.array(z.string()).length(3),
});

export const CopywritingOutputSchema = z.object({
  title: z.string(),
  content: z.string(),
  pictureList: z.array(ImageAnalysisSchema),
});

export const SEOOptimizedNoteReportSchema = z.object({
  optimizationSummary: z.string(),
  optimizedTitle: z.string(),
  optimizedContent: z.string(),
  optimizedPictureList: z.array(ImageAnalysisSchema),
  tags: z.array(z.string()).min(5).max(8),
});

export type VisualAnalysisReport = z.infer<typeof VisualAnalysisReportSchema>;
export type ContentStrategyBrief = z.infer<typeof ContentStrategyBriefSchema>;
export type CopywritingOutput = z.infer<typeof CopywritingOutputSchema>;
export type SEOOptimizedNoteReport = z.infer<
  typeof SEOOptimizedNoteReportSchema
>;

export type Lesson3WorkflowStep =
  | "content_strategy"
  | "copywriting"
  | "seo_optimization";

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

export type Lesson3WorkflowEventHandler = (event: Lesson3WorkflowEvent) => void;

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
你的目标：基于 CES 互动评分算法，为产品制定一套能穿透 L1 冷启动池并具有长尾搜索价值的内容策略。
必须使用 Save_Intermediate_Product_Tool 工具保存中间结果。
最终结果必须符合 ContentStrategyBrief 结构。所有输出必须使用中文。
`.trim();

const contentWriterSystemPrompt = `
你是：资深 MCN 内容撰写编辑。
你的目标：基于内容策划简报和视觉分析报告，撰写一篇具有高互动率和情绪价值的小红书笔记文案，并生成图片列表。
必须使用 Save_Intermediate_Product_Tool 工具保存中间结果。
最终结果必须符合 CopywritingOutput 结构。所有输出必须使用中文。
`.trim();

const seoOptimizerSystemPrompt = `
你是：资深小红书搜索优化专家。
你的目标：基于内容策划简报和文案撰写产出，对小红书笔记进行搜索和推荐优化。
必须使用 Save_Intermediate_Product_Tool 工具保存中间结果。
最终结果必须符合 SEOOptimizedNoteReport 结构。所有输出必须使用中文。
`.trim();

const llm = new AliyunQwenChatModel({
  model: "qwen3.7-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

function createContentStrategistAgent() {
  return createAgent({
    model: llm,
    tools: [saveIntermediateProductTool],
    systemPrompt: contentStrategistSystemPrompt,
    responseFormat: ContentStrategyBriefSchema,
  });
}

function createContentWriterAgent() {
  return createAgent({
    model: llm,
    tools: [saveIntermediateProductTool],
    systemPrompt: contentWriterSystemPrompt,
    responseFormat: CopywritingOutputSchema,
  });
}

function createSeoOptimizerAgent() {
  return createAgent({
    model: llm,
    tools: [saveIntermediateProductTool],
    systemPrompt: seoOptimizerSystemPrompt,
    responseFormat: SEOOptimizedNoteReportSchema,
  });
}

function createContentStrategyTaskMessage(visualReport: VisualAnalysisReport) {
  return `
**任务要求**：
1. 仔细分析视觉报告中的用户意图、图片质量和整体风格
2. 基于 CES 算法和反漏斗模型，制定精准的内容策略
3. 使用 Save_Intermediate_Product_Tool 工具保存中间思考过程
4. 最终输出必须符合 ContentStrategyBrief 结构

视觉分析报告如下：
${JSON.stringify(visualReport, null, 2)}
`.trim();
}

function createCopywritingTaskMessage(
  visualReport: VisualAnalysisReport,
  strategyBrief: ContentStrategyBrief,
) {
  return `
**任务要求**：
1. 仔细阅读视觉分析报告和内容策划简报
2. 撰写完整的小红书笔记文案
3. 根据文案和视觉分析报告筛选合适的图片并排序
4. 使用 Save_Intermediate_Product_Tool 工具保存中间思考过程
5. 最终输出必须符合 CopywritingOutput 结构

视觉分析报告如下：
${JSON.stringify(visualReport, null, 2)}

内容策划简报如下：
${JSON.stringify(strategyBrief, null, 2)}
`.trim();
}

function createSeoOptimizationTaskMessage(
  strategyBrief: ContentStrategyBrief,
  copywritingOutput: CopywritingOutput,
) {
  return `
**任务要求**：
1. 仔细阅读内容策划简报中的 SEO 关键词列表
2. 在不改变文案核心内容和风格的前提下，对文案进行 SEO 优化
3. 优化标题、正文和标签，提升笔记的搜索排名潜力
4. 使用 Save_Intermediate_Product_Tool 工具保存中间思考过程
5. 最终输出必须符合 SEOOptimizedNoteReport 结构

内容策划简报如下：
${JSON.stringify(strategyBrief, null, 2)}

文案撰写产出如下：
${JSON.stringify(copywritingOutput, null, 2)}
`.trim();
}

export async function runLesson3WorkflowWithStream(
  visualReport: VisualAnalysisReport,
  onEvent?: Lesson3WorkflowEventHandler,
): Promise<Lesson3WorkflowResult> {
  const parsedVisualReport = VisualAnalysisReportSchema.parse(visualReport);
  onEvent?.({ type: "workflow_start", input: parsedVisualReport });

  const strategyBrief = await runAgentStepWithStream({
    step: "content_strategy",
    agent: createContentStrategistAgent(),
    message: createContentStrategyTaskMessage(parsedVisualReport),
    schema: ContentStrategyBriefSchema,
    outputType: "ContentStrategyBrief",
    onEvent,
  });

  const copywritingOutput = await runAgentStepWithStream({
    step: "copywriting",
    agent: createContentWriterAgent(),
    message: createCopywritingTaskMessage(parsedVisualReport, strategyBrief),
    schema: CopywritingOutputSchema,
    outputType: "CopywritingOutput",
    onEvent,
  });

  const finalReport = await runAgentStepWithStream({
    step: "seo_optimization",
    agent: createSeoOptimizerAgent(),
    message: createSeoOptimizationTaskMessage(strategyBrief, copywritingOutput),
    schema: SEOOptimizedNoteReportSchema,
    outputType: "SEOOptimizedNoteReport",
    onEvent,
  });

  const result: Lesson3WorkflowResult = {
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

  onEvent?.({ type: "workflow_end", result });
  return result;
}

async function runAgentStepWithStream<TOutput>(input: {
  step: Lesson3WorkflowStep;
  agent: ReactAgent;
  message: string;
  schema: z.ZodType<TOutput>;
  outputType: string;
  onEvent: Lesson3WorkflowEventHandler | undefined;
}): Promise<TOutput> {
  input.onEvent?.({ type: "step_start", step: input.step });

  const stream = await input.agent.stream(
    {
      messages: [{ role: "user", content: input.message }],
    },
    { streamMode: "values" },
  );

  let structuredResponse: TOutput | undefined;

  for await (const chunk of stream) {
    const lastMessage = chunk.messages.at(-1);
    input.onEvent?.({
      type: "agent_update",
      step: input.step,
      messageType: getMessageType(lastMessage),
      content: maskBase64ImageContent(getMessageContent(lastMessage)),
    });

    const toolCalls = getToolCalls(lastMessage);
    if (toolCalls.length > 0) {
      input.onEvent?.({
        type: "tool_calls",
        step: input.step,
        toolCalls,
      });
    }

    if (chunk.structuredResponse) {
      structuredResponse = input.schema.parse(chunk.structuredResponse);
      input.onEvent?.({
        type: "step_structured_response",
        step: input.step,
        structuredResponse,
      });
    }
  }

  if (!structuredResponse) {
    throw new Error(
      `${input.outputType} 未获取到结构化输出 structuredResponse`,
    );
  }

  input.onEvent?.({
    type: "step_end",
    step: input.step,
    outputType: input.outputType,
  });

  return structuredResponse;
}

export function normalizeLesson3WorkflowEventForLog(
  event: Lesson3WorkflowEvent,
): Record<string, unknown> {
  if (event.type === "tool_calls") {
    return {
      type: event.type,
      step: event.step,
      toolCalls: event.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.args,
      })),
    };
  }

  return { ...event };
}

export function formatLesson3WorkflowEvent(event: Lesson3WorkflowEvent) {
  if (event.type === "workflow_start") {
    return "Workflow 已启动";
  }

  if (event.type === "step_start") {
    return `步骤开始：${getStepLabel(event.step)}`;
  }

  if (event.type === "agent_update") {
    return `${getStepLabel(event.step)}：Agent 状态更新 ${event.messageType ?? "unknown"}`;
  }

  if (event.type === "tool_calls") {
    const toolNames = event.toolCalls
      .map((toolCall) => toolCall.name)
      .join("、");
    return `${getStepLabel(event.step)}：正在调用工具 ${toolNames}`;
  }

  if (event.type === "step_structured_response") {
    return `${getStepLabel(event.step)}：结构化输出已生成`;
  }

  if (event.type === "step_end") {
    return `步骤完成：${getStepLabel(event.step)} (${event.outputType})`;
  }

  return "Workflow 已完成";
}

export function getStepLabel(step: Lesson3WorkflowStep) {
  if (step === "content_strategy") {
    return "内容策略生成";
  }

  if (step === "copywriting") {
    return "文案撰写";
  }

  return "SEO 优化";
}

function getMessageType(message: unknown): string | undefined {
  if (
    message &&
    typeof message === "object" &&
    "getType" in message &&
    typeof (message as { getType?: unknown }).getType === "function"
  ) {
    return (message as { getType: () => string }).getType();
  }

  return undefined;
}

function getMessageContent(message: unknown) {
  if (!message || typeof message !== "object" || !("content" in message)) {
    return undefined;
  }

  return (message as { content?: unknown }).content;
}
