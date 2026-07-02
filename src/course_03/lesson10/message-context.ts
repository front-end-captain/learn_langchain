import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "langchain";
import type { MessageContent } from "@langchain/core/messages";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SessionContextRole = "system" | "user" | "assistant" | "tool";

export interface SessionToolCall {
  type?: "tool_call";
  id?: string;
  name: string;
  args: Record<string, JsonValue>;
}

export interface SessionInvalidToolCall {
  id?: string;
  name?: string;
  args?: string;
  error?: string;
}

export interface SessionContextMessage {
  role: SessionContextRole;
  content: JsonValue;
  id?: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: SessionToolCall[];
  invalid_tool_calls?: SessionInvalidToolCall[];
  additional_kwargs?: Record<string, JsonValue>;
  response_metadata?: Record<string, JsonValue>;
  metadata?: Record<string, JsonValue>;
  status?: "success" | "error";
  ts?: string;
}

export const SUMMARY_PROMPT = `将以下对话历史压缩为结构化摘要，只保留关键信息：
1. 用户目标：这段对话要完成什么
2. 关键事实：重要的结论、文件路径、操作结果
3. 未完成事项：尚未完成的任务（如有）

禁止包含：中间过程、失败尝试、重复内容。

对话历史：
{history}`;

export type SummarizeChunk = (
  messages: BaseMessage[],
) => string | Promise<string>;

export interface CompressMessagesOptions {
  freshKeepTurns: number;
  chunkTokens: number;
  compressThreshold: number;
  modelContextLimit: number;
  summarizeChunk: SummarizeChunk;
}

export function load_session_ctx(
  session_id: string,
  sessions_dir: string,
): SessionContextMessage[] {
  const p = path.resolve(sessions_dir, `${session_id}_ctx.json`);
  if (!existsSync(p)) {
    return [];
  }

  return JSON.parse(readFileSync(p, "utf-8")) as SessionContextMessage[];
}

export function save_session_ctx(
  session_id: string,
  messages: SessionContextMessage[],
  sessions_dir: string,
): void {
  mkdirSync(sessions_dir, { recursive: true });
  writeFileSync(
    path.resolve(sessions_dir, `${session_id}_ctx.json`),
    JSON.stringify(messages, null, 2),
    "utf-8",
  );
}

export function append_session_raw(
  session_id: string,
  messages: SessionContextMessage[],
  sessions_dir: string,
): void {
  mkdirSync(sessions_dir, { recursive: true });
  const ts = new Date().toISOString();
  const lines = messages
    .map((message) => JSON.stringify({ ...message, ts }))
    .join("\n");

  if (lines.length === 0) {
    return;
  }

  appendFileSync(
    path.resolve(sessions_dir, `${session_id}_raw.jsonl`),
    `${lines}\n`,
    "utf-8",
  );
}

export function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }

  if (typeof value === "object") {
    const record: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined && typeof item !== "function") {
        record[key] = toJsonValue(item);
      }
    }
    return record;
  }

  return String(value);
}

function toJsonRecord(value: unknown): Record<string, JsonValue> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const jsonValue = toJsonValue(value);
  return typeof jsonValue === "object" &&
    jsonValue !== null &&
    !Array.isArray(jsonValue)
    ? jsonValue
    : undefined;
}

function toMessageContent(content: JsonValue): MessageContent {
  return typeof content === "string" || Array.isArray(content)
    ? (content as MessageContent)
    : JSON.stringify(content);
}

export function messageContentToText(
  content: MessageContent | JsonValue,
): string {
  if (content === null || content === undefined) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  if (typeof content === "number" || typeof content === "boolean") {
    return String(content);
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (
          item &&
          typeof item === "object" &&
          "text" in item &&
          typeof item["text"] === "string"
        ) {
          return item["text"];
        }

        return JSON.stringify(item);
      })
      .join("\n");
  }

  return JSON.stringify(content);
}

function baseMessageRole(message: BaseMessage): SessionContextRole {
  return SystemMessage.isInstance(message)
    ? "system"
    : HumanMessage.isInstance(message)
      ? "user"
      : ToolMessage.isInstance(message)
        ? "tool"
        : "assistant";
}

export function sessionMessageToBaseMessage(
  message: SessionContextMessage,
): BaseMessage {
  const baseFields: {
    content: MessageContent;
    id?: string;
    name?: string;
    additional_kwargs?: Record<string, unknown>;
    response_metadata?: Record<string, unknown>;
  } = {
    content: toMessageContent(message.content),
  };

  if (message.id !== undefined) {
    baseFields.id = message.id;
  }
  if (message.name !== undefined) {
    baseFields.name = message.name;
  }
  if (message.additional_kwargs !== undefined) {
    baseFields.additional_kwargs = message.additional_kwargs;
  }
  if (message.response_metadata !== undefined) {
    baseFields.response_metadata = message.response_metadata;
  }

  if (message.role === "system") {
    return new SystemMessage(baseFields);
  }
  if (message.role === "user") {
    return new HumanMessage(baseFields);
  }
  if (message.role === "tool") {
    const toolFields = {
      ...baseFields,
      tool_call_id: message.tool_call_id ?? "",
    };

    if (message.status !== undefined) {
      Object.assign(toolFields, { status: message.status });
    }
    if (message.metadata !== undefined) {
      Object.assign(toolFields, { metadata: message.metadata });
    }

    return new ToolMessage(toolFields);
  }

  const aiFields = { ...baseFields };
  if (message.tool_calls !== undefined) {
    Object.assign(aiFields, { tool_calls: message.tool_calls });
  }
  if (message.invalid_tool_calls !== undefined) {
    Object.assign(aiFields, { invalid_tool_calls: message.invalid_tool_calls });
  }

  return new AIMessage(aiFields);
}

export function baseMessageToSessionMessage(
  message: BaseMessage,
): SessionContextMessage {
  const sessionMessage: SessionContextMessage = {
    role: baseMessageRole(message),
    content: toJsonValue(message.content),
  };

  if (message.id !== undefined) {
    sessionMessage.id = message.id;
  }
  if (message.name !== undefined) {
    sessionMessage.name = message.name;
  }

  const additionalKwargs = toJsonRecord(message.additional_kwargs);
  if (
    additionalKwargs !== undefined &&
    Object.keys(additionalKwargs).length > 0
  ) {
    sessionMessage.additional_kwargs = additionalKwargs;
  }

  const responseMetadata = toJsonRecord(message.response_metadata);
  if (
    responseMetadata !== undefined &&
    Object.keys(responseMetadata).length > 0
  ) {
    sessionMessage.response_metadata = responseMetadata;
  }

  if (AIMessage.isInstance(message)) {
    const toolCalls = message.tool_calls?.map((toolCall) => {
      const sessionToolCall: SessionToolCall = {
        name: toolCall.name,
        args: toJsonRecord(toolCall.args) ?? {},
      };
      if (toolCall.type !== undefined) {
        sessionToolCall.type = toolCall.type;
      }
      if (toolCall.id !== undefined) {
        sessionToolCall.id = toolCall.id;
      }
      return sessionToolCall;
    });
    if (toolCalls && toolCalls.length > 0) {
      sessionMessage.tool_calls = toolCalls;
    }

    const invalidToolCalls = message.invalid_tool_calls?.map((toolCall) => {
      const sessionInvalidToolCall: SessionInvalidToolCall = {};
      if (toolCall.id !== undefined) {
        sessionInvalidToolCall.id = toolCall.id;
      }
      if (toolCall.name !== undefined) {
        sessionInvalidToolCall.name = toolCall.name;
      }
      if (toolCall.args !== undefined) {
        sessionInvalidToolCall.args = toolCall.args;
      }
      if (toolCall.error !== undefined) {
        sessionInvalidToolCall.error = toolCall.error;
      }
      return sessionInvalidToolCall;
    });
    if (invalidToolCalls && invalidToolCalls.length > 0) {
      sessionMessage.invalid_tool_calls = invalidToolCalls;
    }
  }

  if (ToolMessage.isInstance(message)) {
    sessionMessage.tool_call_id = message.tool_call_id;
    if (message.status !== undefined) {
      sessionMessage.status = message.status;
    }
    const metadata = toJsonRecord(message.metadata);
    if (metadata !== undefined && Object.keys(metadata).length > 0) {
      sessionMessage.metadata = metadata;
    }
  }

  return sessionMessage;
}

export function baseMessagesToSessionMessages(
  messages: BaseMessage[],
): SessionContextMessage[] {
  return messages.map(baseMessageToSessionMessage);
}

export function approximateMessageTokens(message: BaseMessage): number {
  return Math.floor(messageContentToText(message.content).length / 2);
}

export function approximateMessagesTokens(messages: BaseMessage[]): number {
  return messages.reduce(
    (total, message) => total + approximateMessageTokens(message),
    0,
  );
}

export function chunkMessagesByTokens(
  messages: BaseMessage[],
  chunkTokens: number,
): BaseMessage[][] {
  if (messages.length === 0) {
    return [];
  }

  const chunks: BaseMessage[][] = [];
  let current: BaseMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = approximateMessageTokens(message);
    if (current.length > 0 && currentTokens + messageTokens > chunkTokens) {
      chunks.push(current);
      current = [message];
      currentTokens = messageTokens;
    } else {
      current.push(message);
      currentTokens += messageTokens;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

export function formatMessagesForSummary(
  messages: BaseMessage[],
  maxContentChars = 300,
): string {
  return messages
    .map((message) => {
      const role = baseMessageRole(message);
      const content = messageContentToText(message.content).slice(
        0,
        maxContentChars,
      );
      return `${role}: ${content}`;
    })
    .join("\n");
}

export async function maybeCompressMessages(
  messages: BaseMessage[],
  options: CompressMessagesOptions,
): Promise<BaseMessage[]> {
  const approxTokens = approximateMessagesTokens(messages);
  if (approxTokens / options.modelContextLimit < options.compressThreshold) {
    return messages;
  }

  const systemMessages = messages.filter((message) =>
    SystemMessage.isInstance(message),
  );
  const nonSystemMessages = messages.filter(
    (message) => !SystemMessage.isInstance(message),
  );
  const userIndices = nonSystemMessages.flatMap((message, index) =>
    HumanMessage.isInstance(message) ? [index] : [],
  );

  if (userIndices.length <= options.freshKeepTurns) {
    return messages;
  }

  const cutoffIndex = userIndices.at(-options.freshKeepTurns);
  if (cutoffIndex === undefined) {
    return messages;
  }

  const oldMessages = nonSystemMessages.slice(0, cutoffIndex);
  const freshMessages = nonSystemMessages.slice(cutoffIndex);
  const chunks = chunkMessagesByTokens(oldMessages, options.chunkTokens);
  const summaryMessages: BaseMessage[] = [];

  for (const chunk of chunks) {
    const summary = await options.summarizeChunk(chunk);
    summaryMessages.push(
      new SystemMessage(
        `<context_summary>\n${summary.trim()}\n</context_summary>`,
      ),
    );
  }

  return [...systemMessages, ...summaryMessages, ...freshMessages];
}

export function pruneToolResults(
  messages: BaseMessage[],
  keepTurns: number,
): BaseMessage[] {
  const userIndices = messages.flatMap((message, index) =>
    HumanMessage.isInstance(message) ? [index] : [],
  );

  if (userIndices.length <= keepTurns) {
    return messages;
  }

  const cutoffIndex = userIndices.at(-keepTurns);
  if (cutoffIndex === undefined) {
    return messages;
  }

  return messages.map((message, index) => {
    if (index >= cutoffIndex || !ToolMessage.isInstance(message)) {
      return message;
    }

    const prunedToolFields = {
      content: "[已剪枝]",
      tool_call_id: message.tool_call_id,
    };

    if (message.id !== undefined) {
      Object.assign(prunedToolFields, { id: message.id });
    }
    if (message.name !== undefined) {
      Object.assign(prunedToolFields, { name: message.name });
    }
    if (message.status !== undefined) {
      Object.assign(prunedToolFields, { status: message.status });
    }
    if (message.metadata !== undefined) {
      Object.assign(prunedToolFields, { metadata: message.metadata });
    }

    return new ToolMessage(prunedToolFields);
  });
}
