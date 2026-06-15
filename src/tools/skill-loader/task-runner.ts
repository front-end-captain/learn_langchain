import { createAgent } from "langchain";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model.ts";
import {
  DEFAULT_SANDBOX_MCP_URL,
  DEFAULT_SANDBOX_MOUNT_DESC,
  type SkillAgentRunnerInput,
  type SkillLoaderOptions,
} from "./types.ts";

function stringifyMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && "text" in item) {
          return String(item.text);
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }

  if (content == null) {
    return "";
  }

  return String(content);
}

export function createDefaultSkillModel() {
  return new AliyunQwenChatModel({
    model: process.env["QWEN_MODEL"] ?? "qwen3.7-plus",
    apiKey: process.env["QWEN_API_KEY"] ?? "",
    apiBase: process.env["QWEN_API_BASE"] ?? "",
    temperature: 0.3,
  });
}

export async function defaultMcpToolsProvider(url: string): Promise<any[]> {
  const client = new MultiServerMCPClient({
    sandbox: {
      transport: "http",
      url,
    },
  });
  return client.getTools();
}

export async function defaultAgentRunner({
  model,
  tools,
  systemPrompt,
  taskContext,
}: SkillAgentRunnerInput): Promise<string> {
  if (!model) {
    throw new Error("Task 型 Skill 缺少可用模型实例");
  }

  const agent = createAgent({
    model: model as never,
    tools,
    systemPrompt,
  });

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content: taskContext,
      },
    ],
  });

  const lastMessage = result.messages.at(-1);
  return stringifyMessageContent(lastMessage?.content);
}

export async function runTaskSkill(input: {
  skillName: string;
  instructions: string;
  taskContext: string;
  options: SkillLoaderOptions;
}): Promise<string> {
  const mcpUrl = input.options.sandboxMcpUrl ?? DEFAULT_SANDBOX_MCP_URL;
  const sandboxMountDesc =
    input.options.sandboxMountDesc ?? DEFAULT_SANDBOX_MOUNT_DESC;
  const model = input.options.model ?? createDefaultSkillModel();
  const getTools = input.options.mcpToolsProvider ?? defaultMcpToolsProvider;
  const runAgent = input.options.agentRunner ?? defaultAgentRunner;

  const tools = await getTools(mcpUrl);
  const systemPrompt = [
    `你是 ${input.skillName.toUpperCase()} Skill 执行专家。`,
    `你必须严格遵循以下 Skill 指令：\n${input.instructions}`,
    `执行要求：\n${sandboxMountDesc}`,
    "所有脚本和文件操作必须通过 MCP 沙盒工具完成。",
  ].join("\n\n");

  return runAgent({
    model,
    tools,
    systemPrompt,
    taskContext: input.taskContext,
  });
}
