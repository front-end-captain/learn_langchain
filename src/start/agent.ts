import { createAgent, createMiddleware } from "langchain";
import * as z from "zod";
import { AliyunQwenChatModel } from "../llm/aliyun-qwen-chat-model";
import {
  createAgentUpdateEvent,
  getToolCalls,
  createToolCallsEvent,
  createStructuredResponseEvent,
  type AgentStreamEventHandler,
} from "../helper/agent-stream";
import { getWeather } from "../tools/get-weather";
import { auditLogTransformer } from "./transformer";

const WeatherReportSchema = z.object({
  city: z.string().describe("输入的城市"),
  weather: z.string().describe("天气结果"),
});

const model = new AliyunQwenChatModel({
  model: "qwen3.7-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

// NOTE: 系统提示词不需要强调期望的输出格式
const systemPrompt = `
你是：天气评论分析专家
你的目标：根据 get_weather 返回的天气结果，进行简单分析，比如穿衣建议、事宜运动、是否带伞等
`;

// NOTE: 如果 createAgent 时指定了 `responseFormat`， 用户提示词需要强调期望的输出格式
const userPrompt = `
**输出要求**：
最终结果必须符合 WeatherReport 结构。
对于天气结果，可以添加一些天气的修饰词
`;

export async function run(input: string, onEvent?: AgentStreamEventHandler) {
  let weatherReport: string | undefined;
  let finalMessageType: string | undefined;

  const agent = createAgent({
    model,
    tools: [getWeather],
    systemPrompt: systemPrompt,
    responseFormat: WeatherReportSchema,
    middleware: [myMiddleware],
  });

  const stream = await agent.stream(
    {
      messages: [
        {
          role: "user",
          content: input + "\n" + userPrompt,
        },
      ],
    },
    { streamMode: "values" },
  );

  for await (const chunk of stream) {
    const lastMessage = chunk.messages.at(-1);
    finalMessageType = lastMessage?.getType?.();

    onEvent?.(createAgentUpdateEvent(lastMessage));

    const toolCalls = getToolCalls(lastMessage);
    if (toolCalls.length > 0) {
      onEvent?.(createToolCallsEvent(toolCalls));
    }

    if (chunk.structuredResponse) {
      const weather = WeatherReportSchema.parse(chunk.structuredResponse);
      weatherReport = weather?.city + ": " + weather?.weather;
      onEvent?.(createStructuredResponseEvent(weatherReport));
    }
  }

  return { type: finalMessageType, message: weatherReport };
}

const myMiddleware = createMiddleware({
  name: "MyMiddleware",
  streamTransformers: [auditLogTransformer],
});
async function _run(input: string) {
  const agent = createAgent({
    model,
    tools: [getWeather],
    systemPrompt: systemPrompt,
    responseFormat: WeatherReportSchema,
    middleware: [myMiddleware],
  });
  const stream = await agent.streamEvents(
    {
      messages: [
        {
          role: "user",
          content: input + "\n" + userPrompt,
        },
      ],
    },
    { version: "v3" },
  );
  for await (const log of stream.extensions.auditLogs) {
    console.info("log", JSON.stringify(log, null, 2));
  }
  // for await (const message of stream.messages) {
  //   for await (const delta of message.text) {
  //     process.stdout.write(delta);
  //   }
  // }

  const finalState = await stream.output;
  console.info("finalState", finalState);
}

_run("今天北京天气怎么样");
