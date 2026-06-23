import { tool } from "@langchain/core/tools";
import { SkillInstructionsStore } from "./skill-loader/instructions.ts";
import { SkillRegistry } from "./skill-loader/registry.ts";
import { runTaskSkill } from "./skill-loader/task-runner.ts";
import {
  DEFAULT_SANDBOX_SKILLS_MOUNT,
  normalizeTaskContext,
  resolveSessionDir,
  skillLoaderInputSchema,
  type HistoryMessageEntry,
  type SkillLoaderInput,
  type SkillLoaderOptions,
} from "./skill-loader/types.ts";

export const SKILL_LOADER_TOOL_NAME = "skill_loader";

function wrapSkillInstructions(instructions: string): string {
  return `<skill_instructions>\n${instructions}\n</skill_instructions>`;
}

function handleHistoryReader(
  taskContext: string,
  historyAll: HistoryMessageEntry[],
): string {
  const params = parseHistoryReaderParams(taskContext);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.max(1, Math.min(50, params.pageSize ?? 20));
  const total = historyAll.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const messages = historyAll.slice(start, start + pageSize).map((message) => ({
    role: message.role,
    content: message.content,
  }));

  return JSON.stringify({
    errcode: 0,
    message: `成功读取第 ${page} 页，共 ${total} 条消息，本页 ${messages.length} 条`,
    data: {
      messages,
      total,
      page,
      page_size: pageSize,
      total_pages: totalPages,
    },
  });
}

function parseHistoryReaderParams(taskContext: string): {
  page?: number;
  pageSize?: number;
} {
  try {
    const parsed = JSON.parse(taskContext || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const page = toPositiveInteger(record["page"]);
    const pageSize = toPositiveInteger(record["page_size"]);
    const params: { page?: number; pageSize?: number } = {};
    if (page !== undefined) {
      params.page = page;
    }
    if (pageSize !== undefined) {
      params.pageSize = pageSize;
    }
    return params;
  } catch {
    return {};
  }
}

function toPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }
  return Math.trunc(parsed);
}

export class SkillLoaderToolService {
  readonly registry: SkillRegistry;

  readonly instructionsStore: SkillInstructionsStore;

  readonly options: SkillLoaderOptions;

  description = "SkillLoaderTool 正在初始化。";

  private initialized = false;

  constructor(options: SkillLoaderOptions = {}) {
    this.options = options;
    this.registry = new SkillRegistry(options.skillsDir);
    const instructionsOptions: {
      sandboxSkillsMount: string;
      sessionId?: string;
      sessionDir: string;
      routingKey?: string;
    } = {
      sandboxSkillsMount: options.sandboxSkillsMount ?? DEFAULT_SANDBOX_SKILLS_MOUNT,
      sessionDir: resolveSessionDir(options),
    };
    if (options.sessionId) {
      instructionsOptions.sessionId = options.sessionId;
    }
    if (options.routingKey) {
      instructionsOptions.routingKey = options.routingKey;
    }
    this.instructionsStore = new SkillInstructionsStore(instructionsOptions);
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.registry.load();
      this.description = this.registry.buildDescription({
        sessionDir: resolveSessionDir(this.options),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.description =
        `SkillLoaderTool 初始化失败：解析 load_skills.yaml 或读取 Skill 文件时出错，错误信息：${message}`;
    } finally {
      this.initialized = true;
    }
  }

  async execute(input: SkillLoaderInput): Promise<string> {
    await this.init();

    const meta = this.registry.getSkillMeta(input.skill_name);
    if (!meta) {
      return `错误：未找到 Skill '${input.skill_name}'，可用：${JSON.stringify(this.registry.listSkillNames())}`;
    }

    const taskContext = normalizeTaskContext(input.task_context);

    if (input.skill_name === "history_reader") {
      return handleHistoryReader(taskContext, this.options.historyAll ?? []);
    }

    const instructions = await this.instructionsStore.get(meta.name, meta.path);

    if (meta.type === "reference") {
      return wrapSkillInstructions(instructions);
    }

    if (!taskContext.trim()) {
      return [
        wrapSkillInstructions(instructions),
        "",
        "⚠️ 这是任务型 Skill（type: task），需要 task_context 才能执行。",
        "请在下次调用时传入完整的 task_context，包含：",
        "1. 要执行的具体操作",
        "2. 预期输出格式和 JSON schema",
        "3. 所有必要参数值、输入/输出文件路径和额外约束",
      ].join("\n");
    }

    const runner = this.options.taskRunner ?? runTaskSkill;
    return runner({
      skillName: meta.name,
      instructions,
      taskContext,
      options: this.options,
    });
  }
}

export async function createSkillLoaderTool(options: SkillLoaderOptions = {}) {
  const service = new SkillLoaderToolService(options);
  await service.init();

  return tool(
    async (input) => {
      return service.execute(input);
    },
    {
      name: SKILL_LOADER_TOOL_NAME,
      description: service.description,
      schema: skillLoaderInputSchema,
    },
  );
}
