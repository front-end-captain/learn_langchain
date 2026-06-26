import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createAgent } from "langchain";

import {
  createAgentUpdateEvent,
  createStructuredResponseEvent,
  createToolCallsEvent,
  formatAgentStreamEvent,
  getToolCalls,
  normalizeAgentStreamEventForLog,
  type AgentStreamEvent,
  type AgentStreamEventHandler,
} from "../../helper/agent-stream.ts";
import {
  createAgentRunFileLogger,
  type AgentRunFileLogger,
  type LogFormat,
} from "../../helper/file-logger.ts";
import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model.ts";
import { createSkillLoaderTool } from "../../tools/skill-loader-tool.ts";
import type { SkillLoaderOptions } from "../../tools/skill-loader/types.ts";
import type { SenderProtocol } from "../models.ts";
import type { AgentFn } from "../runner.ts";
import type { MessageEntry } from "../session/models.ts";
import { MainTaskOutputSchema, type MainTaskOutput } from "./models.ts";

const DEFAULT_MAX_HISTORY_TURNS = 20;
const MEMORY_INDEX_MAX_LINES = 200;

const BOOTSTRAP_INSTRUCTION_FILES = [
  { fileName: "soul.md", tag: "soul" },
  { fileName: "user.md", tag: "user_profile" },
  { fileName: "agent.md", tag: "agent_rules" },
] as const;

const SYSTEM_PROMPT = `
你是 XiaoPaw（小爪子），部署在飞书的本地工作助手，专为企业内网场景设计。

你的目标是理解用户的工作需求，给出准确、有帮助、适合直接发送到飞书的回复。

你的核心工具是 skill_loader，这是通往各种专业能力的唯一入口。
所有搜索、文件处理、飞书操作、网页浏览、历史读取等能力，都必须先通过 skill_loader 选择合适的 Skill。
不要把 Skill 名称当作工具直接调用；只能调用 skill_loader。
调用 task 类型 Skill 时，task_context 必须包含完整任务描述、预期输出格式和 JSON schema。

行为边界：
- 不确定用户意图时，主动询问；
- 不要声称已经执行未接入的外部工具；
- 回复应简洁清晰、自然友好；
- 最终必须生成符合 MainTaskOutput 的结构化结果。
`;

export function buildBootstrapSystemPrompt(instructionsDir?: string): string {
  const parts = [SYSTEM_PROMPT.trim()];

  if (!instructionsDir) {
    return parts.join("\n\n");
  }

  for (const { fileName, tag } of BOOTSTRAP_INSTRUCTION_FILES) {
    const filePath = join(instructionsDir, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    const content = readFileSync(filePath, "utf8").trim();
    parts.push(`<${tag}>\n${content}\n</${tag}>`);
  }

  const memoryPath = join(instructionsDir, "memory.md");
  if (existsSync(memoryPath)) {
    const lines = readFileSync(memoryPath, "utf8")
      .split(/\r?\n/)
      .slice(0, MEMORY_INDEX_MAX_LINES);
    parts.push(`<memory_index>\n${lines.join("\n")}\n</memory_index>`);
  }

  return parts.join("\n\n");
}

export type BuildAgentFnOptions = {
  sender?: SenderProtocol;
  model?: BaseChatModel;
  maxHistoryTurns?: number;
  onEvent?: AgentStreamEventHandler;
  skillsDir?: string;
  instructionsDir?: string;
  sandboxMcpUrl?: string;
  sandboxSkillsMount?: string;
  workspaceRoot?: string;
  subAgentModel?: string;
  subAgentMaxIter?: number;
  taskRunner?: SkillLoaderOptions["taskRunner"];
  agentLogDir?: string;
  agentLogFormat?: LogFormat;
};

type AgentChunk = {
  messages?: BaseMessage[];
  structuredResponse?: unknown;
};

export function formatHistory(
  history: MessageEntry[],
  maxTurns: number = DEFAULT_MAX_HISTORY_TURNS,
): string {
  if (history.length === 0) {
    return "（无历史记录）";
  }

  const truncated = history.length > maxTurns;
  const recent = truncated ? history.slice(-maxTurns) : history;
  const lines = recent.map((entry) => {
    const role = entry.role === "user" ? "用户" : "助手";
    return `${role}: ${entry.content}`;
  });

  let result = lines.join("\n");
  if (truncated) {
    const omitted = history.length - maxTurns;
    result = `（已省略更早的 ${omitted} 条消息。如需查阅，可通过 history_reader Skill 按页读取完整历史。）\n${result}`;
  }

  return result;
}

export function buildUserPrompt(input: {
  userMessage: string;
  history: MessageEntry[];
  maxHistoryTurns?: number;
}): string {
  return [
    "【历史对话】",
    formatHistory(
      input.history,
      input.maxHistoryTurns ?? DEFAULT_MAX_HISTORY_TURNS,
    ),
    "",
    "【用户消息】",
    input.userMessage,
    "",
    "请理解用户需求并完成当前阶段可完成的任务。",
    "",
    "【输出要求】",
    "以结构化结果返回，包含：",
    '{"reply":"发送给飞书用户的回复，清晰简洁，直接回答需求","used_skills":[]}',
    "reply 字段内容应适合通过飞书消息直接发送，语气自然友好。",
  ].join("\n");
}

export function buildAgentFn(options: BuildAgentFnOptions = {}): AgentFn {
  const maxHistoryTurns = options.maxHistoryTurns ?? DEFAULT_MAX_HISTORY_TURNS;
  const model = options.model ?? createDefaultModel();

  return async function agentFn(
    userMessage,
    history,
    _sessionId,
    routingKey,
    rootId,
    verbose,
  ): Promise<string> {
    const fileLogger = createOptionalAgentLogger(options, {
      routingKey,
      rootId,
      sessionId: _sessionId,
    });
    const skillLoaderOptions: SkillLoaderOptions = {
      sessionId: _sessionId,
      routingKey,
      historyAll: history,
    };
    if (options.skillsDir) {
      skillLoaderOptions.skillsDir = options.skillsDir;
    }
    if (options.sandboxMcpUrl) {
      skillLoaderOptions.sandboxMcpUrl = options.sandboxMcpUrl;
    }
    if (options.sandboxSkillsMount) {
      skillLoaderOptions.sandboxSkillsMount = options.sandboxSkillsMount;
    }
    if (options.workspaceRoot) {
      skillLoaderOptions.workspaceRoot = options.workspaceRoot;
    }
    if (options.subAgentModel) {
      skillLoaderOptions.subAgentModel = options.subAgentModel;
    }
    if (options.subAgentMaxIter) {
      skillLoaderOptions.subAgentMaxIter = options.subAgentMaxIter;
    }
    if (options.taskRunner) {
      skillLoaderOptions.taskRunner = options.taskRunner;
    }
    const skillLoaderTool = await createSkillLoaderTool(skillLoaderOptions);
    const agent = createAgent({
      model,
      tools: [skillLoaderTool],
      systemPrompt: buildBootstrapSystemPrompt(options.instructionsDir),
      responseFormat: MainTaskOutputSchema,
    });
    const prompt = buildUserPrompt({ userMessage, history, maxHistoryTurns });
    const stream = await agent.stream(
      { messages: [{ role: "user", content: prompt }] },
      { streamMode: "values" },
    );

    let output: MainTaskOutput | undefined;
    let fallbackReply = "";

    for await (const rawChunk of stream) {
      const chunk = rawChunk as AgentChunk;
      const lastMessage = chunk.messages?.at(-1);
      if (lastMessage) {
        fallbackReply = extractMessageText(lastMessage) || fallbackReply;
        const event = createAgentUpdateEvent(lastMessage);
        safeWriteAgentEvent(fileLogger, event);
        await emitEvent(event, options, routingKey, rootId, verbose);

        const toolCalls = getToolCalls(lastMessage);
        if (toolCalls.length > 0) {
          const toolEvent = createToolCallsEvent(toolCalls);
          safeWriteAgentEvent(fileLogger, toolEvent);
          await emitEvent(toolEvent, options, routingKey, rootId, verbose);
        }
      }

      if (chunk.structuredResponse) {
        output = MainTaskOutputSchema.parse(chunk.structuredResponse);
        const event = createStructuredResponseEvent(output);
        safeWriteAgentEvent(fileLogger, event);
        await emitEvent(event, options, routingKey, rootId, verbose);
      }
    }

    if (output) {
      safeWriteAgentEnd(fileLogger, "success", output.reply);
      return output.reply;
    }
    const parsedFallback = parseStructuredReply(fallbackReply);
    if (parsedFallback) {
      safeWriteAgentEnd(fileLogger, "success", parsedFallback.reply);
      return parsedFallback.reply;
    }
    if (fallbackReply.trim()) {
      safeWriteAgentEnd(fileLogger, "success", fallbackReply);
      return fallbackReply;
    }

    safeWriteAgentEnd(
      fileLogger,
      "error",
      undefined,
      new Error("主 Agent 未返回可用回复"),
    );
    throw new Error("主 Agent 未返回可用回复");
  };
}

function createOptionalAgentLogger(
  options: BuildAgentFnOptions,
  input: { routingKey: string; rootId: string; sessionId: string },
): AgentRunFileLogger<string> | undefined {
  if (!options.agentLogDir) {
    return undefined;
  }

  try {
    const logger = createAgentRunFileLogger<string>({
      logDir: options.agentLogDir,
      runName: "xiaopaw_agent",
      runId: input.rootId,
      format: options.agentLogFormat ?? "jsonl",
    });
    logger.writeRunStart({
      routingKey: input.routingKey,
      rootId: input.rootId,
      sessionId: input.sessionId,
    });
    return logger;
  } catch {
    return undefined;
  }
}

function safeWriteAgentEvent(
  logger: AgentRunFileLogger<string> | undefined,
  event: AgentStreamEvent,
): void {
  try {
    logger?.writeEvent(normalizeAgentStreamEventForLog(event));
  } catch {
    // Observability must never block the Agent path.
  }
}

function safeWriteAgentEnd(
  logger: AgentRunFileLogger<string> | undefined,
  status: "success" | "error",
  result?: string,
  error?: unknown,
): void {
  try {
    const payload: {
      status: "success" | "error";
      result?: string;
      error?: unknown;
    } = { status };
    if (result !== undefined) {
      payload.result = result;
    }
    if (error !== undefined) {
      payload.error = error;
    }
    logger?.writeRunEnd(payload);
    logger?.close();
  } catch {
    // Observability must never block the Agent path.
  }
}

async function emitEvent(
  event: AgentStreamEvent,
  options: BuildAgentFnOptions,
  routingKey: string,
  rootId: string,
  verbose: boolean,
): Promise<void> {
  options.onEvent?.(event);

  if (!verbose || !options.sender) {
    return;
  }

  try {
    await options.sender.send(
      routingKey,
      formatAgentStreamEvent(event),
      rootId,
    );
  } catch (error) {
    console.warn("verbose event send failed", error);
  }
}

function parseStructuredReply(text: string): MainTaskOutput | undefined {
  if (!text.trim()) {
    return undefined;
  }

  try {
    return MainTaskOutputSchema.parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function extractMessageText(message: BaseMessage): string {
  if (!(message instanceof AIMessage)) {
    return "";
  }
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  return JSON.stringify(content);
}

function createDefaultModel(): BaseChatModel {
  return new AliyunQwenChatModel({
    model: process.env["QWEN_MODEL"] ?? "qwen3.6-max-preview",
    temperature: 0.3,
  });
}
