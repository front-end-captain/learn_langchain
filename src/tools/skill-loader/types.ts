import { fileURLToPath } from "node:url";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ClientTool, ServerTool } from "@langchain/core/tools";
import * as z from "zod";

export const DEFAULT_SKILLS_DIR = fileURLToPath(
  new URL("../../skills/", import.meta.url),
);
export const DEFAULT_SANDBOX_SKILLS_MOUNT = "/mnt/skills";
export const DEFAULT_SANDBOX_MCP_URL = "http://localhost:8022/mcp";
export const DEFAULT_SANDBOX_MOUNT_DESC = [
  "1. 所有的操作必须在沙盒中执行，不得操作本地文件系统，当前已挂载在沙盒的本地目录为./workspace/data:/workspace/data:ro和./workspace/output:/workspace/output:rw",
  "2. 如果需要读取本地文件，则需要本地文件在./workspace/data/目录下，且提供的本地路径会在对应沙盒绝对路径的/workspace/data/目录下。如果文件不在./workspace/data/目录下，则需要提示用户本地文件路径错误，无法执行任务。",
  "3. 任务预期输出的文件，必须写在沙盒绝对路径的/workspace/output/目录下，且提供的本地路径会在对应的./workspace/output/目录下",
  "4. 如遇依赖缺失，先在沙盒中安装再继续",
].join("\n");

export const skillLoaderInputSchema = z.object({
  skill_name: z
    .string()
    .describe(
      "要加载的 Skill 名称，必须严格来自工具描述 XML 列表中的 <name> 值",
    ),
  task_context: z
    .string()
    .optional()
    .describe(
      [
        "如果是参考型 skill，此项可为空。",
        "如果是任务型 skill，此项为调用此 Skill 要完成的子任务完整描述。",
        "建议包含：任务目标、预期输出格式、必要参数、输入/输出文件路径和额外约束。",
      ].join(""),
    ),
});

export type SkillLoaderInput = {
  skill_name: string;
  task_context?: unknown;
};

export function normalizeTaskContext(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) || typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export const skillManifestSchema = z.object({
  skills: z
    .array(
      z.object({
        name: z.string(),
        path: z.string().optional(),
        type: z.enum(["reference", "task"]).default("task"),
        enabled: z.boolean().default(true),
      }),
    )
    .default([]),
});

export type SkillType = "reference" | "task";

export type SkillManifest = z.infer<typeof skillManifestSchema>;

export type SkillMeta = {
  name: string;
  type: SkillType;
  path: string;
  description: string;
};

export type SkillRegistryEntry = Pick<SkillMeta, "type" | "path">;

export type HistoryMessageEntry = {
  role: "user" | "assistant" | string;
  content: string;
};

export type TaskSkillRunner = (input: {
  skillName: string;
  instructions: string;
  taskContext: string;
  options: SkillLoaderOptions;
}) => Promise<string>;

export type SkillAgentTool = ClientTool | ServerTool;

export type McpToolsProvider = (url: string) => Promise<SkillAgentTool[]>;

export type SubAgentRunner = (input: {
  model: BaseChatModel;
  tools: SkillAgentTool[];
  systemPrompt: string;
  taskPrompt: string;
  maxIter: number;
}) => Promise<string>;

export type SkillLoaderOptions = {
  skillsDir?: string; // TODO: remove this option
  sandboxSkillsMount?: string; // TODO: remove this option
  sandboxMountDesc?: string; // TODO: remove this option
  sandboxMcpUrl?: string;
  subAgentModel?: string;
  subAgentChatModel?: BaseChatModel;
  subAgentMaxIter?: number;
  sessionId?: string;
  routingKey?: string;
  historyAll?: HistoryMessageEntry[];
  workspaceRoot?: string;
  sessionDir?: string;
  taskRunner?: TaskSkillRunner;
  mcpToolsProvider?: McpToolsProvider;
  subAgentRunner?: SubAgentRunner;
};

export function resolveSessionDir(options: Pick<SkillLoaderOptions, "sessionDir" | "workspaceRoot" | "sessionId">): string {
  if (options.sessionDir) {
    return options.sessionDir.replace(/\/$/, "");
  }

  const workspaceRoot = (options.workspaceRoot ?? "/workspace").replace(/\/$/, "");
  const sessionId = options.sessionId || "<session_id>";
  return `${workspaceRoot}/sessions/${sessionId}`;
}
