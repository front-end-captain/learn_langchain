import type { ToolCall } from "@langchain/core/messages/tool";

export type AgentStreamEvent<TStructuredResponse = unknown> =
  | {
      type: "agent_update";
      messageType: string | undefined;
      content: unknown;
    }
  | {
      type: "tool_calls";
      toolCalls: ToolCall[];
    }
  | {
      type: "structured_response";
      structuredResponse: TStructuredResponse;
    };

export type AgentStreamEventHandler<TStructuredResponse = unknown> = (
  event: AgentStreamEvent<TStructuredResponse>,
) => void;

export function createAgentUpdateEvent(
  message: unknown,
): AgentStreamEvent<never> {
  return {
    type: "agent_update",
    messageType: getMessageType(message),
    content: maskBase64ImageContent(getMessageContent(message)),
  };
}

export function createToolCallsEvent(
  toolCalls: ToolCall[],
): AgentStreamEvent<never> {
  return {
    type: "tool_calls",
    toolCalls,
  };
}

export function createStructuredResponseEvent<TStructuredResponse>(
  structuredResponse: TStructuredResponse,
): AgentStreamEvent<TStructuredResponse> {
  return {
    type: "structured_response",
    structuredResponse,
  };
}

export function normalizeAgentStreamEventForLog(
  event: AgentStreamEvent,
): Record<string, unknown> {
  if (event.type === "agent_update") {
    return {
      type: event.type,
      messageType: event.messageType,
      content: event.content,
    };
  }

  if (event.type === "tool_calls") {
    return {
      type: event.type,
      toolCalls: event.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.args,
      })),
    };
  }

  return {
    type: event.type,
    structuredResponse: event.structuredResponse,
  };
}

export function formatAgentStreamEvent(event: AgentStreamEvent) {
  if (event.type === "agent_update") {
    return `Agent 状态更新：${event.messageType ?? "unknown"}`;
  }

  if (event.type === "tool_calls") {
    const toolNames = event.toolCalls
      .map((toolCall) => toolCall.name)
      .join("、");

    return `正在调用工具：${toolNames}`;
  }

  return "结构化输出已生成";
}

export function getToolCalls(message: unknown): ToolCall[] {
  if (!message || typeof message !== "object" || !("tool_calls" in message)) {
    return [];
  }

  const toolCalls = (message as { tool_calls?: unknown }).tool_calls;
  return Array.isArray(toolCalls) ? (toolCalls as ToolCall[]) : [];
}

export function maskBase64ImageContent(content: unknown) {
  if (typeof content !== "string") {
    return content;
  }

  return content.replace(
    /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g,
    "[图片 Base64 内容已省略]",
  );
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
