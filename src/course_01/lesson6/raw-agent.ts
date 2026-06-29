import path from "node:path";
import url from "node:url";
import { AIMessage, HumanMessage, SystemMessage } from "langchain";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ToolCall } from "@langchain/core/messages/tool";

import {
  createAgentUpdateEvent,
  createToolCallsEvent,
  type AgentStreamEventHandler,
} from "../../helper/agent-stream";
import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model";
import { baiduSearchTool } from "../../tools/baidu-search-tool";
import { fileWriterTool } from "../../tools/file-writer-tool";
import { scrapeWebsiteTool } from "../../tools/scrape-website-tool";
import { getWeather } from "../../tools/get-weather";

type JsonObject = Record<string, unknown>;

type RawTool = {
  name: string;
  description?: string;
  invoke(input: unknown): Promise<unknown>;
};

type RawAgentFields = {
  role: string;
  goal: string;
  backstory: string;
  tools: RawTool[];
  model: BaseChatModel;
  maxIterations?: number;
};

type RunResult = {
  message: string | undefined;
  type: string | undefined;
};

type ParseToolArgsResult =
  | {
      ok: true;
      args: JsonObject;
    }
  | {
      ok: false;
      error: string;
    };

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MAX_ITERATIONS = 12;

const llm = new AliyunQwenChatModel({
  model: process.env["QWEN_MODEL"] ?? "qwen-turbo",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

export function createTaskMessage() {
  return `
帮我调研极客时间的相关信息，请分析这个研究任务，规划完成研究所需的步骤，并产出一份专业的调研报告。

**重要要求**：
1. 每次使用搜索工具（search_web）后，必须从搜索结果中选择最相关的网页链接
2. 必须使用网页抓取工具（Read website content）抓取这些网页的完整内容
3. 不要仅依赖搜索结果中的摘要信息，摘要往往不完整
4. 对于每个重要信息点，都要有对应的原始网页内容支撑
5. 优先抓取官方网站、权威媒体、专业百科等高质量来源

输出文件：'{主题}-最终报告.md'
`.trim();
}

const expectedOutput = `
完整的 Markdown 格式研究报告，并写入文件，满足以下标准：

1. 内容完整性：覆盖研究目标、背景、核心业务、产品服务、用户群体和公开信息来源
2. 信息准确性：所有关键信息都有明确引用来源，引用格式为 [描述](URL)
3. 结构规范性：章节层次清晰，Markdown 格式正确
4. 质量保证：报告基于抓取到的网页内容，而不是仅基于搜索摘要
`.trim();

export class RawAgent {
  private readonly role: string;

  private readonly goal: string;

  private readonly backstory: string;

  private readonly tools: Map<string, RawTool>;

  private readonly model: BaseChatModel;

  private readonly maxIterations: number;

  constructor(fields: RawAgentFields) {
    this.role = fields.role;
    this.goal = fields.goal;
    this.backstory = fields.backstory;
    this.tools = new Map(fields.tools.map((tool) => [tool.name, tool]));
    this.model = fields.model;
    this.maxIterations = fields.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  }

  async run(
    description: string,
    finalAnswerCriteria: string,
    onEvent?: AgentStreamEventHandler,
  ): Promise<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(await this.generateSystemPrompt()),
      new HumanMessage(
        await this.generateUserPrompt(description, finalAnswerCriteria),
      ),
    ];

    onEvent?.(createAgentUpdateEvent(messages[0]));
    onEvent?.(createAgentUpdateEvent(messages[1]));

    let response = await this.callModel(messages);
    onEvent?.(createAgentUpdateEvent(response));

    for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
      const responseText = stringifyMessageContent(response.content);

      if (responseText.includes("Final Answer:")) {
        return this.extractFinalAnswer(responseText);
      }

      const toolName = this.parseToolName(responseText);
      const toolInput = this.parseToolInput(responseText);
      const parsedToolArgs = this.parseToolArgs(toolInput);
      const toolArgs = parsedToolArgs.ok ? parsedToolArgs.args : {};

      onEvent?.(
        createToolCallsEvent([
          {
            id: `raw-tool-call-${iteration + 1}`,
            name: toolName,
            args: toolArgs,
          } satisfies ToolCall,
        ]),
      );

      const toolResult = parsedToolArgs.ok
        ? await this.executeTool(toolName, toolArgs)
        : parsedToolArgs.error;
      const observationMessage = new AIMessage(
        `${responseText}\nObservation:${toolResult}`,
      );
      messages.push(observationMessage);
      onEvent?.(createAgentUpdateEvent(observationMessage));

      response = await this.callModel(messages);
      onEvent?.(createAgentUpdateEvent(response));
    }

    throw new Error(
      `RawAgent 达到最大循环次数 ${this.maxIterations}，仍未得到 Final Answer。`,
    );
  }

  private async callModel(messages: BaseMessage[]): Promise<BaseMessage> {
    return this.model.invoke(messages, {
      stop: ["Observation:"],
    });
  }

  private async generateSystemPrompt(): Promise<string> {
    const template = await Bun.file(
      path.join(__dirname, "raw-agent-system-prompt.txt"),
    ).text();

    const toolsMap = Array.from(this.tools.values())
      .map((tool) =>
        [
          `Tool Name: ${tool.name}`,
          `Tool Description: ${tool.description ?? "无描述"}`,
        ].join("\n"),
      )
      .join("\n\n");
    const toolsName = Array.from(this.tools.keys()).join(", ");

    return renderTemplate(template, {
      role: this.role,
      goal: this.goal,
      backstory: this.backstory,
      tools_map: toolsMap,
      tools_name: toolsName,
    });
  }

  private async generateUserPrompt(
    description: string,
    finalAnswerCriteria: string,
  ): Promise<string> {
    const template = await Bun.file(
      path.join(__dirname, "raw-agent-user-prompt.txt"),
    ).text();

    return renderTemplate(template, {
      description,
      expected_output: finalAnswerCriteria,
    });
  }

  private parseToolName(response: string): string {
    const match = response.match(/^Action:\s*(.+)$/m);

    if (!match?.[1]) {
      throw new Error(`响应中未找到 Action 字段。响应内容：\n${response}`);
    }

    return match[1].trim();
  }

  private parseToolInput(response: string): string {
    const match = response.match(/^Action Input:\s*(.+)$/m);

    if (!match?.[1]) {
      throw new Error(
        `响应中未找到 Action Input 字段。响应内容：\n${response}`,
      );
    }

    return match[1].trim();
  }

  private parseToolArgs(toolInput: string): ParseToolArgsResult {
    try {
      const parsed = toolInput.trim() ? JSON.parse(toolInput) : {};

      if (isJsonObject(parsed)) {
        return {
          ok: true,
          args: parsed,
        };
      }

      return {
        ok: true,
        args: { input: parsed },
      };
    } catch (error) {
      return {
        ok: false,
        error: `错误：无法解析工具输入参数（JSON 格式错误）：${toolInput}。错误：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async executeTool(
    toolName: string,
    toolArgs: JsonObject,
  ): Promise<string> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return `错误：工具 '${toolName}' 不存在。可用工具：${Array.from(this.tools.keys()).join(", ")}`;
    }

    try {
      const result = await tool.invoke(toolArgs);
      return stringifyToolResult(result);
    } catch (error) {
      return `错误：执行工具 '${toolName}' 时发生异常：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private extractFinalAnswer(response: string): string {
    const marker = "Final Answer:";
    const markerIndex = response.indexOf(marker);

    if (markerIndex === -1) {
      throw new Error(
        `响应中未找到 Final Answer 字段。响应内容：\n${response}`,
      );
    }

    return response.slice(markerIndex + marker.length).trim();
  }
}

export async function run(
  input: string,
  onEvent?: AgentStreamEventHandler,
): Promise<RunResult> {
  const agent = new RawAgent({
    role: "网络调研专家",
    goal: "通过手写 ReAct 循环完成用户指定的调研任务，并生成结构化 Markdown 调研报告写入文件",
    backstory:
      "你是一位经验丰富的网络调研专家，擅长通过搜索、网页抓取和文件写入工具收集、验证、整理公开网络信息。",
    tools: [baiduSearchTool, scrapeWebsiteTool, fileWriterTool],
    model: llm,
  });

  const message = await agent.run(
    input.trim() ? input : createTaskMessage(),
    expectedOutput,
    onEvent,
  );

  return {
    message,
    type: "ai",
  };
}

export async function runWeather(
  input: string,
  onEvent?: AgentStreamEventHandler,
): Promise<RunResult> {
  const agent = new RawAgent({
    role: "天气评论分析专家",
    goal: "根据 get_weather 返回的天气结果，进行简单分析，比如穿衣建议、事宜运动、是否带伞等",
    backstory: "",
    tools: [getWeather],
    model: llm,
  });

  const message = await agent.run(
    "今天北京天气怎么样",
    "对于天气结果，可以添加一些天气的修饰词",
    onEvent,
  );

  return {
    message,
    type: "ai",
  };
}

function renderTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{([a-z_]+)\}/g, (placeholder, key: string) => {
    return variables[key] ?? placeholder;
  });
}

function stringifyMessageContent(content: BaseMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return JSON.stringify(content);
}

function stringifyToolResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
