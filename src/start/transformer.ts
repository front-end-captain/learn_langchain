import { type ProtocolEvent, StreamChannel } from "@langchain/langgraph";

type AgentAuditLog =
  | {
      type: "run_started" | "run_finished";
      graphName: string;
      timestamp: number;
    }
  | {
      type: "node_started" | "node_finished";
      nodeName: string;
      namespace: string[];
      timestamp: number;
    }
  | {
      type: "llm_finished";
      node?: string | undefined;
      runId?: string;
      model?: string;
      finishReason?: string;
      tokenUsage?: unknown;
      timestamp: number;
    }
  | {
      type: "tool_planned";
      node?: string | undefined;
      runId?: string;
      toolCallId?: string;
      toolName: string;
      args?: unknown;
      timestamp: number;
    }
  | {
      type: "tool_started";
      toolCallId: string;
      toolName: string;
      input?: unknown;
      timestamp: number;
    }
  | {
      type: "tool_finished";
      toolCallId: string;
      toolName?: string;
      output?: unknown;
      durationMs?: number | undefined;
      timestamp: number;
    }
  | {
      type: "tool_failed";
      toolCallId?: string;
      toolName?: string;
      error?: unknown;
      durationMs?: number | undefined;
      timestamp: number;
    }
  | {
      type: "structured_response";
      response: unknown;
      timestamp: number;
    };

function safeParseJson(value: unknown) {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractToolOutput(output: any) {
  const kwargs = output?.kwargs;
  if (!kwargs) return output;

  return {
    status: kwargs.status,
    content: safeParseJson(kwargs.content),
    name: kwargs.name,
    toolCallId: kwargs.tool_call_id,
  };
}

function parseRawToolCall(raw: any) {
  const fn = raw?.function;

  return {
    toolCallId: raw?.id,
    toolName: fn?.name,
    args: safeParseJson(fn?.arguments),
  };
}

export function auditLogTransformer() {
  // 不传 name，所以这是旁路 channel，不会产生 custom:auditLogs 原始事件。
  const auditLogs = new StreamChannel<AgentAuditLog>();

  const toolStartedAt = new Map<string, number>();

  return {
    init: () => ({
      auditLogs,
    }),

    process(event: ProtocolEvent) {
      const timestamp = event?.params?.timestamp ?? Date.now();
      const namespace = event?.params?.namespace ?? [];
      const data = (event?.params?.data ?? {}) as any;

      if (event.method === "lifecycle") {
        const lifecycleEvent = data.event;
        const graphName = data.graph_name;

        if (namespace.length === 0) {
          if (lifecycleEvent === "running" || lifecycleEvent === "started") {
            auditLogs.push({
              type: "run_started",
              graphName,
              timestamp,
            });
          }

          if (lifecycleEvent === "completed") {
            auditLogs.push({
              type: "run_finished",
              graphName,
              timestamp,
            });
          }

          return true;
        }

        if (lifecycleEvent === "started") {
          auditLogs.push({
            type: "node_started",
            nodeName: graphName,
            namespace,
            timestamp,
          });
        }

        if (lifecycleEvent === "completed") {
          auditLogs.push({
            type: "node_finished",
            nodeName: graphName,
            namespace,
            timestamp,
          });
        }

        return true;
      }

      if (event.method === "messages" && data.event === "message-finish") {
        const metadata = data.responseMetadata ?? {};

        auditLogs.push({
          type: "llm_finished",
          node: event.params.node,
          runId: data.run_id,
          model: metadata.model,
          finishReason: metadata.finish_reason,
          tokenUsage: metadata.tokenUsage ?? metadata.usage,
          timestamp,
        });

        for (const rawToolCall of metadata.raw_tool_calls ?? []) {
          const toolCall = parseRawToolCall(rawToolCall);

          if (!toolCall.toolName) continue;

          auditLogs.push({
            type: "tool_planned",
            node: event.params.node,
            runId: data.run_id,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            args: toolCall.args,
            timestamp,
          });
        }

        return true;
      }

      if (event.method === "tools") {
        const toolCallId = data.tool_call_id;
        const toolName = data.tool_name;

        if (data.event === "tool-started") {
          if (toolCallId) toolStartedAt.set(toolCallId, timestamp);

          auditLogs.push({
            type: "tool_started",
            toolCallId,
            toolName,
            input: safeParseJson(data.input),
            timestamp,
          });

          return true;
        }

        if (data.event === "tool-finished") {
          const startedAt = toolCallId
            ? toolStartedAt.get(toolCallId)
            : undefined;

          auditLogs.push({
            type: "tool_finished",
            toolCallId,
            toolName,
            output: extractToolOutput(data.output),
            durationMs: startedAt == null ? undefined : timestamp - startedAt,
            timestamp,
          });

          if (toolCallId) toolStartedAt.delete(toolCallId);

          return true;
        }

        if (data.event === "tool-error") {
          const startedAt = toolCallId
            ? toolStartedAt.get(toolCallId)
            : undefined;

          auditLogs.push({
            type: "tool_failed",
            toolCallId,
            toolName,
            error: data.error,
            durationMs: startedAt == null ? undefined : timestamp - startedAt,
            timestamp,
          });

          if (toolCallId) toolStartedAt.delete(toolCallId);

          return true;
        }
      }

      if (event.method === "updates") {
        const structuredResponse = data?.values?.structuredResponse;

        if (structuredResponse !== undefined) {
          auditLogs.push({
            type: "structured_response",
            response: structuredResponse,
            timestamp,
          });
        }

        return true;
      }

      return true;
    },
  };
}
