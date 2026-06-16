import { tool } from "@langchain/core/tools";
import { SkillInstructionsStore } from "./skill-loader/instructions.ts";
import { SkillRegistry } from "./skill-loader/registry.ts";
import { runTaskSkill } from "./skill-loader/task-runner.ts";
import {
  DEFAULT_SANDBOX_SKILLS_MOUNT,
  skillLoaderInputSchema,
  type SkillLoaderInput,
  type SkillLoaderOptions,
} from "./skill-loader/types.ts";

export const SKILL_LOADER_TOOL_NAME = "skill_loader";

function wrapSkillInstructions(instructions: string): string {
  return `<skill_instructions>\n${instructions}\n</skill_instructions>`;
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
    this.instructionsStore = new SkillInstructionsStore(
      options.sandboxSkillsMount ?? DEFAULT_SANDBOX_SKILLS_MOUNT,
    );
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.registry.load();
      this.description = this.registry.buildDescription();
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

    const instructions = await this.instructionsStore.get(meta.name, meta.path);

    if (meta.type === "reference") {
      return wrapSkillInstructions(instructions);
    }

    if (!input.task_context.trim()) {
      return [
        wrapSkillInstructions(instructions),
        "",
        "⚠️ 这是任务型 Skill（type: task），需要 task_context 才能执行。",
        "请在下次调用时传入完整的 task_context，包含：",
        "1. 要执行的具体操作",
        "2. 预期输出格式",
        "3. 所有必要参数值",
      ].join("\n");
    }

    return runTaskSkill({
      skillName: meta.name,
      instructions,
      taskContext: input.task_context,
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
