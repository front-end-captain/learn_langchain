import { createAgent } from "langchain";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model.ts";
import {
  DEFAULT_SANDBOX_MCP_URL,
  resolveSessionDir,
  type SkillLoaderOptions,
  type SubAgentRunner,
} from "./types.ts";

const DEFAULT_SUB_AGENT_MODEL = "qwen3.6-max-preview";
const DEFAULT_SUB_AGENT_MAX_ITER = 20;

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
  const loaded = await loadDefaultMcpTools(url);
  return loaded.tools;
}

async function loadDefaultMcpTools(url: string) {
  const client = new MultiServerMCPClient({
    sandbox: {
      transport: "http",
      url,
    },
  });
  const tools = await client.getTools();
  return {
    tools,
    close: () => client.close(),
  };
}

export function buildSkillAgentSystemPrompt(input: {
  skillName: string;
  instructions: string;
  sessionDir: string;
}): string {
  const skillNameUpper = input.skillName.toUpperCase();
  return [
    `你是 ${skillNameUpper} Skill 执行专家。`,
    `目标：严格按照 ${input.skillName} Skill 的操作规范，在 AIO-Sandbox 中完成任务。`,
    [
      "当前 Session 沙盒工作目录：",
      `${input.sessionDir}/`,
      `- 用户上传的文件位于：${input.sessionDir}/uploads/`,
      `- 任务输出文件写入：${input.sessionDir}/outputs/`,
      `- 临时工作区：${input.sessionDir}/tmp/`,
    ].join("\n"),
    [
      "工具使用规范（必须严格遵守）：",
      `- 你没有名为 '${input.skillName}' 的直接工具，绝对禁止将 '${input.skillName}' 当作工具名调用。`,
      "- 所有脚本和文件操作必须通过 MCP 沙盒工具完成，禁止直接操作本地文件系统。",
      "- 可使用 sandbox_execute_bash、sandbox_execute_code、sandbox_file_operations、sandbox_str_replace_editor、sandbox_convert_to_markdown。",
      "- web_browse 等动态网页任务可使用 browser_* 系列工具。",
      '- MCP 工具参数必须是合法 JSON；不需要的可选参数直接省略，不要传 "None"、"True" 或 "False" 字符串。',
      "- 需要把结构化数据返回给上层 Agent 时，必须通过 stdout 输出 JSON 字符串。",
      "- 工具结果过大被截断时，改用分批处理、摘要、写入 outputs 后再读取等方式继续。",
    ].join("\n"),
    `你掌握以下操作规范，请严格遵循：\n\n${input.instructions}`,
  ].join("\n\n");
}

export function buildSkillTaskPrompt(input: {
  taskContext: string;
  sessionDir: string;
}): string {
  return [
    "根据以下任务要求，使用你掌握的 Skill 操作规范完成任务。",
    "",
    "任务要求：",
    input.taskContext,
    "",
    "执行约束：",
    "1. 所有操作必须在 AIO-Sandbox 中执行，禁止直接操作本地文件系统",
    `2. 输入文件从沙盒路径 ${input.sessionDir}/uploads/ 读取`,
    `3. 输出文件必须写到沙盒路径 ${input.sessionDir}/outputs/ 目录下`,
    "4. 如遇依赖缺失，先在沙盒中安装再继续",
    "5. 返回结果必须符合 task_context 中定义的 JSON schema",
  ].join("\n");
}

function createSubAgentModel(options: SkillLoaderOptions) {
  if (options.subAgentChatModel) {
    return options.subAgentChatModel;
  }

  return new AliyunQwenChatModel({
    model:
      options.subAgentModel ??
      process.env["QWEN_SUB_AGENT_MODEL"] ??
      process.env["QWEN_MODEL"] ??
      DEFAULT_SUB_AGENT_MODEL,
    temperature: 0.3,
  });
}

export const defaultSubAgentRunner: SubAgentRunner = async (input) => {
  const agent = createAgent({
    model: input.model,
    tools: input.tools,
    systemPrompt: input.systemPrompt,
  });

  const result = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content: input.taskPrompt,
        },
      ],
    },
    {
      recursionLimit: input.maxIter,
    },
  );

  const lastMessage = result.messages.at(-1);
  return stringifyMessageContent(lastMessage?.content);
};

export async function runTaskSkill(input: {
  skillName: string;
  instructions: string;
  taskContext: string;
  options: SkillLoaderOptions;
}): Promise<string> {
  const mcpUrl = input.options.sandboxMcpUrl ?? DEFAULT_SANDBOX_MCP_URL;
  const sessionDir = resolveSessionDir(input.options);
  const maxIter = input.options.subAgentMaxIter ?? DEFAULT_SUB_AGENT_MAX_ITER;

  const loadedTools = input.options.mcpToolsProvider
    ? {
        tools: await input.options.mcpToolsProvider(mcpUrl),
        close: async () => undefined,
      }
    : await loadDefaultMcpTools(mcpUrl);
  const model = createSubAgentModel(input.options);
  const systemPrompt = buildSkillAgentSystemPrompt({
    skillName: input.skillName,
    instructions: input.instructions,
    sessionDir,
  });
  const taskPrompt = buildSkillTaskPrompt({
    taskContext: input.taskContext,
    sessionDir,
  });
  const runner = input.options.subAgentRunner ?? defaultSubAgentRunner;

  try {
    return await runner({
      model,
      tools: loadedTools.tools,
      systemPrompt,
      taskPrompt,
      maxIter,
    });
  } finally {
    await loadedTools.close();
  }
}
