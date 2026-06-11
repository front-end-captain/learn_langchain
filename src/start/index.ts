import path from "node:path";
import {
  createAgent,
  AIMessage,
  HumanMessage,
  ToolMessage,
  SystemMessage,
  BaseMessage,
} from "langchain";
import type { MessageType } from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import { tool } from "@langchain/core/tools";
import * as z from "zod";
import { AliyunQwenChatModel } from "../llm/aliyun-qwen-chat-model";
import { createAgentRunFileLogger } from "../helper/file-logger";

type AgentStreamEvent<TStructuredResponse = unknown> =
  | {
      type: "agent_update";
      messageType: MessageType | undefined;
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

function createAgentUpdateEvent(
  message?: BaseMessage,
): AgentStreamEvent<never> {
  let agentStreamEvent: AgentStreamEvent = {
    type: "agent_update",
    messageType: "UNKNOWN",
    content: "",
  };
  if (
    message instanceof HumanMessage ||
    message instanceof AIMessage ||
    message instanceof SystemMessage ||
    message instanceof ToolMessage
  ) {
    agentStreamEvent = {
      type: "agent_update",
      messageType: message.getType(),
      content: message.content,
    };
  }

  return agentStreamEvent;
}

function getToolCalls(message?: BaseMessage): ToolCall[] {
  if (message instanceof AIMessage) {
    return message.tool_calls || [];
  }
  return [];
}

function createToolCallsEvent(toolCalls: ToolCall[]): AgentStreamEvent<never> {
  return {
    type: "tool_calls",
    toolCalls,
  };
}

function createStructuredResponseEvent<TStructuredResponse>(
  structuredResponse: TStructuredResponse,
): AgentStreamEvent<TStructuredResponse> {
  return {
    type: "structured_response",
    structuredResponse,
  };
}

function normalizeAgentStreamEventForLog(
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

const getWeather = tool((input) => `It's always sunny in ${input.city}!`, {
  name: "get_weather",
  description: "Get the weather for a given city",
  schema: z.object({
    city: z.string().describe("The city to get the weather for"),
  }),
});

const WeatherReportSchema = z.object({
  city: z.string().describe("输入的城市"),
  weather: z.string().describe("天气结果"),
});
type WeatherReport = z.infer<typeof WeatherReportSchema>;

const model = new AliyunQwenChatModel({
  model: "qwen3.7-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

const agent = createAgent({
  model,
  tools: [getWeather],
  systemPrompt: `
**输出要求**：
最终结果必须符合 WeatherReport 结构。
对于天气结果，可以添加一些天气的修饰词
  `,
  responseFormat: WeatherReportSchema,
});

const stream = await agent.stream(
  {
    messages: [{ role: "user", content: "今天北京的天气怎么样?" }],
  },
  { streamMode: "values" },
);

const fileLogger = createAgentRunFileLogger<
  AgentStreamEvent<WeatherReport>,
  WeatherReport
>({
  logDir: path.join(__dirname, "logs"),
  runName: "start",
  format: "pretty",
  normalizeEvent: normalizeAgentStreamEventForLog,
});

function onEvent(event: AgentStreamEvent<WeatherReport>) {
  fileLogger.writeEvent(event);
}

let weatherReport: WeatherReport | undefined;

for await (const chunk of stream) {
  const lastMessage = chunk.messages.at(-1);
  onEvent?.(createAgentUpdateEvent(lastMessage));

  const toolCalls = getToolCalls(lastMessage);
  if (toolCalls.length > 0) {
    onEvent?.(createToolCallsEvent(toolCalls));
  }

  if (chunk.structuredResponse) {
    weatherReport = WeatherReportSchema.parse(chunk.structuredResponse);
    onEvent?.(createStructuredResponseEvent(weatherReport));
  }
}

console.info(weatherReport?.city + ": " + weatherReport?.weather);
