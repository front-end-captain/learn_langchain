import { createAgent } from "langchain";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model.ts";
import {
  DEFAULT_SANDBOX_MCP_URL,
  DEFAULT_SANDBOX_MOUNT_DESC,
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

export async function mcpToolsProvider(url: string) {
  const client = new MultiServerMCPClient({
    sandbox: {
      transport: "http",
      url,
    },
  });
  return client.getTools();
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

  const tools = await mcpToolsProvider(mcpUrl);
  const systemPrompt = [
    `你是 ${input.skillName.toUpperCase()} Skill 执行专家。`,
    `你必须严格遵循以下 Skill 指令：\n${input.instructions}`,
    `执行要求：\n${sandboxMountDesc}`,
    "所有脚本和文件操作必须通过 MCP 沙盒工具完成。",
  ].join("\n\n");

  const model = new AliyunQwenChatModel({
    model: process.env["QWEN_MODEL"] ?? "qwen3.6-max-preview",
    apiKey: process.env["QWEN_API_KEY"] ?? "",
    apiBase: process.env["QWEN_API_BASE"] ?? "",
    temperature: 0.3,
  });

  const agent = createAgent({
    model,
    tools,
    systemPrompt,
  });

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content: input.taskContext,
      },
    ],
  });

  const lastMessage = result.messages.at(-1);
  return stringifyMessageContent(lastMessage?.content);
}
