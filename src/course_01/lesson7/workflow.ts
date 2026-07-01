import path from "node:path";
import url from "node:url";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { createAgent, ReactAgent } from "langchain";
import * as z from "zod";
import {
  createAgentUpdateEvent,
  createStructuredResponseEvent,
  createToolCallsEvent,
  getToolCalls,
  normalizeAgentStreamEventForLog,
} from "../../helper/agent-stream";

import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model";
import { baiduSearchTool } from "../../tools/baidu-search-tool";
import { fileWriterTool } from "../../tools/file-writer-tool";
import { scrapeWebsiteTool } from "../../tools/scrape-website-tool";
import { createAgentRunFileLogger } from "../../helper/file-logger";

const DEFAULT_TOPIC = "调研极客时间平台的全面信息";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDir = path.join(__dirname, "logs");

const fileLogger = createAgentRunFileLogger({
  logDir: logDir,
  runName: "lesson7",
  format: "pretty",
});

export const ResearchStepSchema = z.object({
  stepNumber: z.number().int().min(1).describe("研究步骤编号。"),
  title: z.string().describe("研究步骤标题。"),
  researchGoal: z.string().describe("该步骤要解决的研究目标。"),
  keyQuestions: z
    .array(z.string())
    .min(1)
    .describe("该步骤需要回答的关键问题。"),
  expectedOutput: z.string().describe("该步骤完成后应该产出的内容。"),
});

export const ResearchPlanSchema = z.object({
  taskAnalysis: z.string().describe("对用户研究任务的目标、背景和边界的分析。"),
  researchDimensions: z
    .array(z.string())
    .min(3)
    .describe("完成调研需要覆盖的关键信息维度。"),
  complexityAssessment: z.string().describe("对任务复杂度和资源需求的判断。"),
  steps: z.array(ResearchStepSchema).min(3).max(8),
  outlineMarkdown: z.string().describe("Markdown 格式的完整报告大纲。"),
});

export const SourceEvidenceSchema = z.object({
  summary: z.string().describe("信息摘要。"),
  quote: z.string().describe("原文片段或搜索摘要中的关键句。"),
  url: z.string().describe("原始网页 URL。"),
});

export const SearchResultSchema = z.object({
  stepNumber: z.number().int().min(1),
  stepTitle: z.string(),
  searchSummary: z.string().describe("本步骤搜索结果的总体概括。"),
  evidences: z.array(SourceEvidenceSchema).min(1),
});

export const StepReportSchema = z.object({
  stepNumber: z.number().int().min(1),
  stepTitle: z.string(),
  markdown: z.string().describe("该研究步骤对应的 Markdown 报告正文。"),
  citations: z.array(z.string()).describe("正文中使用到的引用 URL 列表。"),
});

export const ReviewIssueSchema = z.object({
  location: z.string().describe("问题所在的位置，例如章节名或段落。"),
  description: z.string().describe("问题描述。"),
  suggestion: z.string().describe("修改建议。"),
});

export const ReviewResultSchema = z.object({
  overallEvaluation: z.string().describe("1-2 句话总结报告整体质量。"),
  severeIssues: z.array(ReviewIssueSchema).describe("必须修改的严重问题。"),
  mediumIssues: z.array(ReviewIssueSchema).describe("建议修改的中等问题。"),
  minorIssues: z.array(ReviewIssueSchema).describe("可选修改的轻微问题。"),
  passed: z.boolean().describe("是否已经达到发布质量。"),
});

export const FinalReportDraftSchema = z.object({
  markdown: z.string().describe("完整的最终 Markdown 报告。"),
  outputFileName: z
    .string()
    .describe("最终报告文件名，只包含文件名，不包含目录路径。"),
});

export type ResearchStep = z.infer<typeof ResearchStepSchema>;
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type StepReport = z.infer<typeof StepReportSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
export type FinalReportDraft = z.infer<typeof FinalReportDraftSchema>;

export type WorkflowResult = {
  topic: string;
  plan: ResearchPlan;
  stepReports: StepReport[];
  finalReview: ReviewResult;
  finalReport: string;
  outputFile: string;
};

const ReportState = Annotation.Root({
  topic: Annotation<string>(),
  plan: Annotation<ResearchPlan>(),
  steps: Annotation<ResearchStep[]>(),
  currentStepIndex: Annotation<number>(),
  currentSearchResult: Annotation<SearchResult>(),
  currentStepDraft: Annotation<StepReport>(),
  currentStepReview: Annotation<ReviewResult>(),
  completedStepReports: Annotation<StepReport[], StepReport[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  finalDraft: Annotation<FinalReportDraft>(),
  finalReview: Annotation<ReviewResult>(),
  finalReport: Annotation<string>(),
  outputFile: Annotation<string>(),
});

type ReportStateValue = typeof ReportState.State;

const researcherSystemPrompt = `
你是：深度研究专家。

你的目标：
分析用户的研究任务，输出结构化的研究步骤和专业报告大纲。

工作要求：
1. 识别研究目标、研究边界、关键信息维度。
2. 将任务拆解为 3-8 个清晰步骤。
3. 每个步骤必须包含：编号、标题、研究目标、关键问题、预期产出。
4. 输出完整 Markdown 报告大纲。
5. 所有输出必须使用中文。
`.trim();

const searcherSystemPrompt = `
你是：网络搜索专家。

你的目标：
围绕单个研究步骤快速收集可靠信息，输出结构化证据列表。

工作要求：
1. 优先使用 search_web 搜索关键问题。
2. 必要时使用 Read website content 读取网页正文。
3. 每条证据必须包含信息摘要、原文片段、原始 URL。
4. 不要撰写报告正文，只整理可追溯资料。
5. 所有输出必须使用中文。
`.trim();

const writerSystemPrompt = `
你是：报告撰写研究员。

你的目标：
根据研究计划、搜索资料和审核意见，产出结构清晰、引用完整的 Markdown 报告。

工作要求：
1. 正文中的关键事实必须带 Markdown 引用：[来源描述](URL)。
2. 不得编造搜索结果之外的事实。
3. 修改报告时必须逐条响应审核意见。
4. 最终报告必须保持大纲结构，去除重复内容，保留引用链接。
5. 所有输出必须使用中文。
`.trim();

const editorSystemPrompt = `
你是：报告审核编辑。

你的目标：
审核报告内容、引用、逻辑结构和 Markdown 格式，只给修改意见，不直接改稿。

审核优先级：
1. 信息引用：关键事实、数据、论断是否都有来源。
2. 逻辑结构：章节是否符合大纲，结论是否与正文一致。
3. 内容质量：是否完整覆盖研究步骤。
4. 格式可读性：标题层级、列表、引用格式是否规范。

所有输出必须使用中文。
`.trim();

function createModel() {
  return new AliyunQwenChatModel({
    model: process.env["QWEN_MODEL"] ?? "",
    apiKey: process.env["QWEN_API_KEY"] ?? "",
    apiBase: process.env["QWEN_API_BASE"] ?? "",
  });
}

function createResearcherAgent() {
  return createAgent({
    model: createModel(),
    tools: [],
    systemPrompt: researcherSystemPrompt,
    responseFormat: ResearchPlanSchema,
  });
}

function createSearcherAgent() {
  return createAgent({
    model: createModel(),
    tools: [baiduSearchTool, scrapeWebsiteTool],
    systemPrompt: searcherSystemPrompt,
    responseFormat: SearchResultSchema,
  });
}

function createWriterAgent<TOutput extends Record<string, unknown>>(
  responseFormat: z.ZodType<TOutput>,
) {
  return createAgent({
    model: createModel(),
    tools: [],
    systemPrompt: writerSystemPrompt,
    responseFormat,
  });
}

function createEditorAgent() {
  return createAgent({
    model: createModel(),
    tools: [],
    systemPrompt: editorSystemPrompt,
    responseFormat: ReviewResultSchema,
  });
}

function createPlanTaskMessage(topic: string, outputStructName: string) {
  return `
请规划以下研究任务：

${topic}

请输出结构化研究计划，包含任务分析、关键信息维度、复杂度评估、3-8 个研究步骤和 Markdown 报告大纲。
最终结果必须符合 ${outputStructName} 结构。
`.trim();
}

function createSearchTaskMessage(
  topic: string,
  plan: ResearchPlan,
  step: ResearchStep,
  outputStructName: string,
) {
  return `
研究主题：
${topic}

报告大纲：
${plan.outlineMarkdown}

当前研究步骤：
${JSON.stringify(step, null, 2)}

请围绕当前步骤收集资料，输出结构化搜索结果。每条证据必须包含 summary、quote、url。
最终结果必须符合 ${outputStructName} 结构。
`.trim();
}

function createStepWriteTaskMessage(
  plan: ResearchPlan,
  step: ResearchStep,
  searchResult: SearchResult,
  outputStructName: string,
) {
  return `
研究计划：
${JSON.stringify(plan, null, 2)}

当前步骤：
${JSON.stringify(step, null, 2)}

搜索资料：
${JSON.stringify(searchResult, null, 2)}

请撰写该步骤的 Markdown 报告正文，关键事实必须带引用链接。
最终结果必须符合 ${outputStructName} 结构。
`.trim();
}

function createStepReviewTaskMessage(
  stepReport: StepReport,
  outputStructName: string,
) {
  return `
请审核以下步骤报告，只输出结构化审核意见。

${stepReport.markdown}

最终结果必须符合 ${outputStructName} 结构。
`.trim();
}

function createStepReviseTaskMessage(
  draft: StepReport,
  review: ReviewResult,
  outputStructName: string,
) {
  return `
请根据审核意见修改步骤报告，并输出修改后的 StepReport。

原报告：
${JSON.stringify(draft, null, 2)}

审核意见：
${JSON.stringify(review, null, 2)}

最终结果必须符合 ${outputStructName} 结构。
`.trim();
}

function createFinalIntegrateTaskMessage(
  topic: string,
  plan: ResearchPlan,
  stepReports: StepReport[],
  outputStructName: string,
) {
  return `
研究主题：
${topic}

报告大纲：
${plan.outlineMarkdown}

所有步骤报告：
${JSON.stringify(stepReports, null, 2)}

请整合为一份完整 Markdown 调研报告，并给出输出文件名。
输出文件名必须使用：${sanitizeFilename(topic)}-最终报告.md

最终结果必须符合 ${outputStructName} 结构。
`.trim();
}

function createFinalReviewTaskMessage(
  finalDraft: FinalReportDraft,
  outputStructName: string,
) {
  return `
请对以下最终报告进行发布前审核，只输出结构化审核意见。

${finalDraft.markdown}

最终结果必须符合 ${outputStructName} 结构。
`.trim();
}

function createFinalReviseTaskMessage(
  topic: string,
  draft: FinalReportDraft,
  review: ReviewResult,
  outputStructName: string,
) {
  return `
请根据最终审核意见修改完整报告，并输出最终版 Markdown 和文件名。

文件名必须使用：${sanitizeFilename(topic)}-最终报告.md

原最终报告：
${draft.markdown}

最终审核意见：
${JSON.stringify(review, null, 2)}

最终结果必须符合 ${outputStructName} 结构。
`.trim();
}

async function runStructuredAgent<TOutput extends Record<string, unknown>>({
  agent,
  message,
  schema,
  outputType,
}: {
  agent: ReactAgent;
  message: string;
  schema: z.ZodType<TOutput>;
  outputType: string;
}): Promise<TOutput> {
  const stream = await agent.stream(
    {
      messages: [{ role: "user", content: message }],
    },
    { streamMode: "values" },
  );

  let structuredResponse: TOutput | undefined;

  for await (const chunk of stream) {
    const lastMessage = chunk.messages.at(-1);
    fileLogger.writeEvent(
      normalizeAgentStreamEventForLog(createAgentUpdateEvent(lastMessage)),
    );

    const toolCalls = getToolCalls(lastMessage);
    if (toolCalls.length > 0) {
      fileLogger.writeEvent(
        normalizeAgentStreamEventForLog(createToolCallsEvent(toolCalls)),
      );
    }

    if (chunk.structuredResponse) {
      structuredResponse = schema.parse(chunk.structuredResponse);

      fileLogger.writeEvent(
        normalizeAgentStreamEventForLog(
          createStructuredResponseEvent(chunk.structuredResponse),
        ),
      );
    }
  }

  if (!structuredResponse) {
    throw new Error(`${outputType} 未获取到结构化输出 structuredResponse`);
  }

  return structuredResponse;
}

async function planNode(state: ReportStateValue) {
  // console.info("[planNode]", JSON.stringify(state, null, 2));
  const plan = await runStructuredAgent({
    agent: createResearcherAgent(),
    message: createPlanTaskMessage(state.topic, "ResearchPlanSchema"),
    schema: ResearchPlanSchema,
    outputType: "ResearchPlan",
  });

  return {
    plan,
    steps: plan.steps,
    currentStepIndex: 0,
  };
}

async function searchStepNode(state: ReportStateValue) {
  // console.info("[searchStepNode]", JSON.stringify(state, null, 2));
  const step = getCurrentStep(state);
  const searchResult = await runStructuredAgent({
    agent: createSearcherAgent(),
    message: createSearchTaskMessage(
      state.topic,
      state.plan,
      step,
      "SearchResultSchema",
    ),
    schema: SearchResultSchema,
    outputType: "SearchResult",
  });

  return {
    currentSearchResult: searchResult,
  };
}

async function writeStepNode(state: ReportStateValue) {
  // console.info("[writeStepNode]", JSON.stringify(state, null, 2));
  const step = getCurrentStep(state);
  const stepReport = await runStructuredAgent({
    agent: createWriterAgent(StepReportSchema),
    message: createStepWriteTaskMessage(
      state.plan,
      step,
      state.currentSearchResult,
      "StepReportSchema",
    ),
    schema: StepReportSchema,
    outputType: "StepReport",
  });

  return {
    currentStepDraft: stepReport,
  };
}

async function reviewStepNode(state: ReportStateValue) {
  // console.info("[reviewStepNode]", JSON.stringify(state, null, 2));
  const review = await runStructuredAgent({
    agent: createEditorAgent(),
    message: createStepReviewTaskMessage(
      state.currentStepDraft,
      "ReviewResultSchema",
    ),
    schema: ReviewResultSchema,
    outputType: "ReviewResult",
  });

  return {
    currentStepReview: review,
  };
}

async function reviseStepNode(state: ReportStateValue) {
  // console.info("[reviseStepNode]", JSON.stringify(state, null, 2));
  const revisedReport = await runStructuredAgent({
    agent: createWriterAgent(StepReportSchema),
    message: createStepReviseTaskMessage(
      state.currentStepDraft,
      state.currentStepReview,
      "StepReportSchema",
    ),
    schema: StepReportSchema,
    outputType: "RevisedStepReport",
  });

  return {
    completedStepReports: [revisedReport],
    currentStepIndex: state.currentStepIndex + 1,
  };
}

function routeAfterStep(state: ReportStateValue) {
  console.info("[routeAfterStep]", JSON.stringify(state, null, 2));
  return state.currentStepIndex >= state.steps.length
    ? "integrate_final"
    : "search_step";
}

async function integrateFinalNode(state: ReportStateValue) {
  // console.info("[integrateFinalNode]", JSON.stringify(state, null, 2));
  const finalDraft = await runStructuredAgent({
    agent: createWriterAgent(FinalReportDraftSchema),
    message: createFinalIntegrateTaskMessage(
      state.topic,
      state.plan,
      state.completedStepReports,
      "FinalReportDraftSchema",
    ),
    schema: FinalReportDraftSchema,
    outputType: "FinalReportDraft",
  });

  return {
    finalDraft: normalizeFinalDraft(state.topic, finalDraft),
  };
}

async function reviewFinalNode(state: ReportStateValue) {
  // console.info("[reviewFinalNode]", JSON.stringify(state, null, 2));
  const finalReview = await runStructuredAgent({
    agent: createEditorAgent(),
    message: createFinalReviewTaskMessage(
      state.finalDraft,
      "ReviewResultSchema",
    ),
    schema: ReviewResultSchema,
    outputType: "FinalReview",
  });

  return {
    finalReview,
  };
}

async function reviseFinalNode(state: ReportStateValue) {
  // console.info("[reviseFinalNode]", JSON.stringify(state, null, 2));
  const finalDraft = await runStructuredAgent({
    agent: createWriterAgent(FinalReportDraftSchema),
    message: createFinalReviseTaskMessage(
      state.topic,
      state.finalDraft,
      state.finalReview,
      "FinalReportDraftSchema",
    ),
    schema: FinalReportDraftSchema,
    outputType: "FinalReport",
  });
  const normalizedFinalDraft = normalizeFinalDraft(state.topic, finalDraft);
  const outputFile = path.join(__dirname, normalizedFinalDraft.outputFileName);

  await fileWriterTool.invoke({
    filename: normalizedFinalDraft.outputFileName,
    directory: __dirname,
    overwrite: true,
    content: normalizedFinalDraft.markdown,
  });

  return {
    finalDraft: normalizedFinalDraft,
    finalReport: normalizedFinalDraft.markdown,
    outputFile,
  };
}

function createGraph() {
  return new StateGraph(ReportState)
    .addNode("plan_step", planNode)
    .addNode("search_step", searchStepNode)
    .addNode("write_step", writeStepNode)
    .addNode("review_step", reviewStepNode)
    .addNode("revise_step", reviseStepNode)
    .addNode("integrate_final", integrateFinalNode)
    .addNode("review_final", reviewFinalNode)
    .addNode("revise_final", reviseFinalNode)
    .addEdge(START, "plan_step")
    .addEdge("plan_step", "search_step")
    .addEdge("search_step", "write_step")
    .addEdge("write_step", "review_step")
    .addEdge("review_step", "revise_step")
    .addConditionalEdges("revise_step", routeAfterStep, [
      "search_step",
      "integrate_final",
    ])
    .addEdge("integrate_final", "review_final")
    .addEdge("review_final", "revise_final")
    .addEdge("revise_final", END)
    .compile();
}

export async function run(input = ""): Promise<WorkflowResult> {
  const topic = input.trim() || DEFAULT_TOPIC;

  fileLogger.writeRunStart({ input: topic });

  const graph = createGraph();

  const stream = await graph.streamEvents(
    {
      topic,
    },
    { version: "v3" },
  );

  const state = await stream.output;
  return {
    topic: state.topic,
    plan: state.plan,
    stepReports: state.completedStepReports,
    finalReview: state.finalReview,
    finalReport: state.finalReport,
    outputFile: state.outputFile,
  };
}

function getCurrentStep(state: ReportStateValue): ResearchStep {
  const step = state.steps[state.currentStepIndex];

  if (!step) {
    throw new Error(
      `研究步骤不存在：currentStepIndex=${state.currentStepIndex}, steps=${state.steps.length}`,
    );
  }

  return step;
}

function normalizeFinalDraft(
  topic: string,
  finalDraft: FinalReportDraft,
): FinalReportDraft {
  return {
    markdown: finalDraft.markdown,
    outputFileName: sanitizeFilename(
      finalDraft.outputFileName || topic,
    ).endsWith(".md")
      ? sanitizeFilename(finalDraft.outputFileName || topic)
      : `${sanitizeFilename(topic)}-最终报告.md`,
  };
}

function sanitizeFilename(filename: string): string {
  const sanitized = filename
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || "调研报告";
}

if (import.meta.main) {
  const result = await run(Bun.argv.slice(2).join(" "));
  console.log(JSON.stringify(result, null, 2));
}
