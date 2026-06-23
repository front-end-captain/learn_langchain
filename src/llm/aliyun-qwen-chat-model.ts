import {
  AIMessage,
  type AIMessageChunk,
  BaseMessage,
  isAIMessage,
  isChatMessage,
  isHumanMessage,
  isSystemMessage,
  isToolMessage,
  type MessageContent,
  type ToolCall,
} from "@langchain/core/messages";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import {
  isLangChainTool,
  isStructuredToolParams,
  type StructuredToolInterface,
  type StructuredToolParams,
} from "@langchain/core/tools";
import { toJSONSchema } from "zod/v4";

export type AliyunQwenMessageRole = "system" | "user" | "assistant" | "tool";

type JsonObject = Record<string, unknown>;

type AliyunQwenTextContentBlock = {
  type: "text";
  text: string;
};

type AliyunQwenImageContentBlock = {
  type: "image_url";
  image_url: {
    url: string;
  };
};

type AliyunQwenContent =
  | string
  | Array<AliyunQwenTextContentBlock | AliyunQwenImageContentBlock | JsonObject>
  | null;

export type AliyunQwenToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type AliyunQwenMessage = {
  role: AliyunQwenMessageRole;
  content?: AliyunQwenContent;
  tool_call_id?: string;
  tool_calls?: AliyunQwenToolCall[];
};

export type AliyunQwenToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: JsonObject;
  };
};

type AliyunQwenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type AliyunQwenResponseMessage = {
  role?: "assistant";
  content?: string | null;
  tool_calls?: AliyunQwenToolCall[];
};

type AliyunQwenResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: AliyunQwenResponseMessage;
    finish_reason?: string | null;
  }>;
  usage?: AliyunQwenUsage;
};

export type AliyunQwenChatModelCallOptions = BaseChatModelCallOptions & {
  tools?: AliyunQwenToolDefinition[];
  tool_choice?: string | JsonObject;
};

export type AliyunQwenChatModelFields = BaseChatModelParams & {
  model: string;
  apiKey?: string;
  apiBase?: string;
  imageModel?: string;
  temperature?: number;
  timeout?: number;
  retryCount?: number;
  toolResultMaxChars?: number;
};

type NormalizedMessages = {
  messages: AliyunQwenMessage[];
  useImageModel: boolean;
};

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_IMAGE_MODEL = "qwen3-vl-plus";
const DEFAULT_API_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_TOOL_RESULT_MAX_CHARS = 20_000;
const MAX_EMPTY_CONTENT_RETRIES = 2;

export class AliyunQwenChatModel extends BaseChatModel<AliyunQwenChatModelCallOptions> {
  model: string;

  apiKey: string;

  apiBase: string;

  imageModel: string;

  temperature: number | undefined;

  timeout: number;

  retryCount: number;

  toolResultMaxChars: number;

  constructor(fields: AliyunQwenChatModelFields) {
    super(fields);

    this.model = fields.model;
    this.apiKey =
      fields.apiKey ??
      process.env["QWEN_API_KEY"] ??
      process.env["DASHSCOPE_API_KEY"] ??
      "";
    this.apiBase = fields.apiBase ?? process.env["QWEN_API_BASE"] ?? DEFAULT_API_BASE;
    this.imageModel = fields.imageModel ?? DEFAULT_IMAGE_MODEL;
    this.temperature = fields.temperature;
    this.timeout = fields.timeout ?? DEFAULT_TIMEOUT_MS;
    this.retryCount =
      fields.retryCount ?? parseRetryCount(process.env["LLM_RETRY_COUNT"]);
    this.toolResultMaxChars =
      fields.toolResultMaxChars ??
      parseToolResultMaxChars(process.env["QWEN_TOOL_RESULT_MAX_CHARS"]);

    if (!this.apiKey) {
      throw new ValueError("API Key 未提供");
    }
  }

  override _llmType(): string {
    return "aliyun_qwen_chat_model";
  }

  override invocationParams(
    options?: this["ParsedCallOptions"],
  ): Record<string, unknown> {
    return {
      model: this.model,
      temperature: this.temperature,
      stop: options?.stop,
      tools: options?.tools,
      tool_choice: normalizeToolChoice(options?.tool_choice),
    };
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<AliyunQwenChatModelCallOptions>,
  ): Runnable<
    BaseLanguageModelInput,
    AIMessageChunk,
    AliyunQwenChatModelCallOptions
  > {
    return this.withConfig({
      tools: tools.map(convertToAliyunToolDefinition),
      ...kwargs,
    });
  }

  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const result = await this.completionWithEmptyContentRetry(
      messages,
      options,
    );
    const choice = result.choices?.[0];
    const message = choice?.message;

    if (!choice || !message) {
      throw new ValueError("响应中未找到 choices[0].message 字段");
    }

    const content = message.content ?? "";
    const toolCalls = convertResponseToolCalls(message.tool_calls);
    const responseMetadata: Record<string, unknown> = {
      id: result.id,
      model: result.model,
      finish_reason: choice.finish_reason,
      usage: result.usage,
    };

    if (message.tool_calls) {
      responseMetadata["raw_tool_calls"] = message.tool_calls;
    }

    const aiMessage = new AIMessage({
      content,
      tool_calls: toolCalls,
      response_metadata: responseMetadata,
    });

    return {
      generations: [
        {
          text: content,
          message: aiMessage,
          generationInfo: {
            finish_reason: choice.finish_reason,
          },
        },
      ],
      llmOutput: {
        model: result.model,
        tokenUsage: {
          promptTokens: result.usage?.prompt_tokens ?? 0,
          completionTokens: result.usage?.completion_tokens ?? 0,
          totalTokens: result.usage?.total_tokens ?? 0,
        },
      },
    };
  }

  private async completionWithEmptyContentRetry(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): Promise<AliyunQwenResponse> {
    for (let emptyRetryCount = 0; ; emptyRetryCount += 1) {
      const result = await this.completion(messages, options);
      const message = result.choices?.[0]?.message;
      const hasToolCalls = Boolean(message?.tool_calls?.length);
      const content = message?.content;

      if (hasToolCalls || typeof content !== "string" || content.trim()) {
        return result;
      }

      if (emptyRetryCount >= MAX_EMPTY_CONTENT_RETRIES) {
        throw new ValueError(
          `LLM 连续 ${MAX_EMPTY_CONTENT_RETRIES + 1} 次返回空内容，可能是模型限流或异常，请稍后重试或检查 API 配额`,
        );
      }
    }
  }

  private async completion(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): Promise<AliyunQwenResponse> {
    const normalized = normalizeMultimodalToolResult(
      truncateToolResults(
        convertMessagesToAliyunMessages(messages),
        this.toolResultMaxChars,
      ),
    );
    const payload: Record<string, unknown> = {
      model: normalized.useImageModel ? this.imageModel : this.model,
      messages: normalized.messages,
    };

    if (this.temperature !== undefined) {
      payload["temperature"] = this.temperature;
    }
    if (options.stop && options.stop.length > 0) {
      payload["stop"] = options.stop;
    }
    if (options.tools && options.tools.length > 0) {
      payload["tools"] = options.tools;
    }
    const toolChoice = normalizeToolChoice(options.tool_choice);
    if (toolChoice !== undefined) {
      payload["tool_choice"] = toolChoice;
    }

    if (shouldDebugPayload()) {
      console.debug("QWEN_DEBUG_PAYLOAD", JSON.stringify(payload, null, 2));
    }

    return this.postWithRetry(payload);
  }

  private async postWithRetry(
    payload: Record<string, unknown>,
  ): Promise<AliyunQwenResponse> {
    let lastException: unknown;

    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      try {
        const response = await fetchWithTimeout(
          this.apiBase + "/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
          this.timeout,
        );

        if (response.status >= 500 || response.status === 429) {
          const body = await response.text();
          lastException = new Error(
            `LLM 请求可重试错误 ${response.status}: ${body.slice(0, 200)}`,
          );
          if (attempt < this.retryCount) {
            continue;
          }
          throw lastException;
        }

        if (response.status >= 400) {
          const body = await response.text();
          throw new Error(
            `LLM 请求失败 ${response.status} ${response.url}: ${body.slice(0, 500)}`,
          );
        }

        return (await response.json()) as AliyunQwenResponse;
      } catch (error) {
        lastException = error;
        if (attempt < this.retryCount && isRetryableError(error)) {
          continue;
        }
        throw error;
      }
    }

    throw lastException instanceof Error
      ? lastException
      : new Error("LLM 请求失败：未知错误");
  }
}

export function convertMessagesToAliyunMessages(
  messages: BaseMessage[],
): AliyunQwenMessage[] {
  return messages.map((message, index) => {
    const content = convertMessageContent(message.content);

    if (isSystemMessage(message)) {
      return { role: "system", content };
    }
    if (isHumanMessage(message)) {
      return { role: "user", content };
    }
    if (isAIMessage(message)) {
      const aliyunMessage: AliyunQwenMessage = {
        role: "assistant",
        content: content ?? "",
      };
      const toolCalls = convertLangChainToolCallsToAliyun(message.tool_calls);
      if (toolCalls) {
        aliyunMessage.tool_calls = toolCalls;
      }
      return aliyunMessage;
    }
    if (isToolMessage(message)) {
      return {
        role: "tool",
        tool_call_id: message.tool_call_id,
        content: content ?? "",
      };
    }
    if (isChatMessage(message)) {
      const role = message.role;
      if (isAliyunRole(role)) {
        return { role, content };
      }
    }

    throw new ValueError(`消息 ${index} 的类型暂不支持: ${message.getType()}`);
  });
}

export function normalizeMultimodalToolResult(
  messages: AliyunQwenMessage[],
): NormalizedMessages {
  const out: AliyunQwenMessage[] = [];
  let useImageModel = false;
  let pendingImages: string[] = [];

  for (const message of messages) {
    if (
      message.role === "tool" &&
      typeof message.content === "string" &&
      includesBase64Image(message.content)
    ) {
      const dataUrl = message.content.slice(
        message.content.indexOf("data:image/"),
      );
      const prefix = message.content.slice(
        0,
        message.content.indexOf("data:image/"),
      );
      pendingImages.push(dataUrl);
      out.push({
        ...message,
        content: prefix ? `${prefix}图片内容已加载` : "图片内容已加载",
      });
      useImageModel = true;
      continue;
    }

    if (pendingImages.length > 0 && message.role === "user") {
      const text = typeof message.content === "string" ? message.content : "";
      out.push({
        role: "user",
        content: [
          { type: "text", text },
          ...pendingImages.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        ],
      });
      pendingImages = [];
      continue;
    }

    if (
      message.role === "assistant" &&
      typeof message.content === "string" &&
      message.content.includes("Add image to content Local") &&
      includesBase64Image(message.content)
    ) {
      const dataUrlStart = message.content.indexOf("data:image/");
      out.push({
        role: "user",
        content: [
          {
            type: "text",
            text: `${message.content.slice(0, dataUrlStart)}图片内容已加载`,
          },
          {
            type: "image_url",
            image_url: { url: message.content.slice(dataUrlStart) },
          },
        ],
      });
      useImageModel = true;
      continue;
    }

    out.push(message);
  }

  if (pendingImages.length > 0) {
    out.push({
      role: "user",
      content: [
        { type: "text", text: "请分析上面工具返回的图片内容。" },
        ...pendingImages.map((url) => ({
          type: "image_url" as const,
          image_url: { url },
        })),
      ],
    });
  }

  return { messages: out, useImageModel };
}

export function truncateToolResults(
  messages: AliyunQwenMessage[],
  maxChars: number = DEFAULT_TOOL_RESULT_MAX_CHARS,
): AliyunQwenMessage[] {
  if (maxChars <= 0) {
    return messages;
  }

  return messages.map((message) => {
    if (message.role !== "tool" || typeof message.content !== "string") {
      return message;
    }
    if (message.content.length <= maxChars) {
      return message;
    }

    return {
      ...message,
      content: [
        message.content.slice(0, maxChars),
        "\n\n[工具返回内容已截断：原始内容过长。请换用分批处理、摘要提取或写入文件后再读取的方式继续。]",
      ].join(""),
    };
  });
}

function convertMessageContent(content: MessageContent): AliyunQwenContent {
  if (typeof content === "string") {
    return content;
  }

  return content.map((block) => {
    const contentBlock = block as Record<string, unknown>;
    if (
      contentBlock["type"] === "text" &&
      typeof contentBlock["text"] === "string"
    ) {
      return { type: "text", text: contentBlock["text"] };
    }
    if (contentBlock["type"] === "image") {
      if (typeof contentBlock["url"] === "string") {
        return { type: "image_url", image_url: { url: contentBlock["url"] } };
      }
      if (
        typeof contentBlock["data"] === "string" &&
        typeof contentBlock["mimeType"] === "string"
      ) {
        return {
          type: "image_url",
          image_url: {
            url: `data:${contentBlock["mimeType"]};base64,${contentBlock["data"]}`,
          },
        };
      }
    }

    return contentBlock;
  });
}

function convertLangChainToolCallsToAliyun(
  toolCalls?: ToolCall[],
): AliyunQwenToolCall[] | undefined {
  if (!toolCalls || toolCalls.length === 0) {
    return undefined;
  }

  return toolCalls.map((toolCall) => ({
    id: toolCall.id ?? `call_${crypto.randomUUID().replaceAll("-", "")}`,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.args),
    },
  }));
}

function convertResponseToolCalls(
  toolCalls?: AliyunQwenToolCall[],
): ToolCall[] {
  if (!toolCalls) {
    return [];
  }

  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.function.name,
    args: parseToolCallArguments(toolCall.function.arguments),
    type: "tool_call",
  }));
}

function parseToolCallArguments(args: string): Record<string, unknown> {
  if (!args.trim()) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(args);
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return { __raw: args };
  }
}

function convertToAliyunToolDefinition(
  tool: BindToolsInput,
): AliyunQwenToolDefinition {
  if (isAliyunToolDefinition(tool)) {
    return tool;
  }
  if (isStructuredToolParams(tool)) {
    return structuredToolPartsToDefinition(
      tool.name,
      tool.description,
      tool.schema,
    );
  }
  if (isLangChainTool(tool)) {
    return structuredToolPartsToDefinition(
      tool.name,
      tool.description,
      tool.schema,
    );
  }

  const maybeTool = tool as Partial<StructuredToolInterface>;
  if (typeof maybeTool.name === "string") {
    return structuredToolPartsToDefinition(
      maybeTool.name,
      maybeTool.description,
      maybeTool.schema,
    );
  }

  throw new ValueError(
    "暂不支持该工具定义，无法转换为阿里云 Function Calling schema",
  );
}

function structuredToolPartsToDefinition(
  name: string,
  description: string | undefined,
  schema:
    | StructuredToolInterface["schema"]
    | StructuredToolParams["schema"]
    | undefined,
): AliyunQwenToolDefinition {
  const functionDefinition: AliyunQwenToolDefinition["function"] = {
    name,
    parameters: schemaToJsonObject(schema),
  };

  if (description !== undefined) {
    functionDefinition.description = description;
  }

  return {
    type: "function",
    function: functionDefinition,
  };
}

function schemaToJsonObject(
  schema:
    | StructuredToolInterface["schema"]
    | StructuredToolParams["schema"]
    | undefined,
): JsonObject {
  if (!schema) {
    return { type: "object", properties: {} };
  }

  const schemaValue: unknown = schema;
  if (isRecord(schemaValue) && schemaValue["type"] === "object") {
    return schemaValue;
  }

  try {
    const jsonSchema = toJSONSchema(schema as never) as unknown;
    return isRecord(jsonSchema)
      ? jsonSchema
      : { type: "object", properties: {} };
  } catch {
    return { type: "object", properties: {} };
  }
}

function isAliyunToolDefinition(
  tool: unknown,
): tool is AliyunQwenToolDefinition {
  return (
    isRecord(tool) &&
    tool["type"] === "function" &&
    isRecord(tool["function"]) &&
    typeof tool["function"]["name"] === "string"
  );
}

function isAliyunRole(role: string): role is AliyunQwenMessageRole {
  return (
    role === "system" ||
    role === "user" ||
    role === "assistant" ||
    role === "tool"
  );
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function includesBase64Image(value: string): boolean {
  return value.includes("data:image/") && value.includes(";base64,");
}

function normalizeToolChoice(
  toolChoice: string | JsonObject | undefined,
): string | JsonObject | undefined {
  if (toolChoice === "any") {
    return "auto";
  }

  return toolChoice;
}

function parseRetryCount(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_RETRY_COUNT;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? DEFAULT_RETRY_COUNT : parsed;
}

function parseToolResultMaxChars(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_TOOL_RESULT_MAX_CHARS;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? DEFAULT_TOOL_RESULT_MAX_CHARS : parsed;
}

export function shouldDebugPayload(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env["QWEN_DEBUG_PAYLOAD"] === "1";
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeout: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isRetryableError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}
