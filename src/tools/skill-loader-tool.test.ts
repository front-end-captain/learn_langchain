import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSkillLoaderTool,
  SkillLoaderToolService,
} from "./skill-loader-tool.ts";
import { SkillInstructionsStore } from "./skill-loader/instructions.ts";

async function createSkillsFixture(input: {
  manifest: string;
  skills?: Array<{
    name: string;
    content: string;
  }>;
}) {
  const dir = await mkdtemp(join(tmpdir(), "skill-loader-tool-"));
  await writeFile(join(dir, "load_skills.yaml"), input.manifest, "utf8");

  for (const skill of input.skills ?? []) {
    const skillDir = join(dir, skill.name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), skill.content, "utf8");
  }

  return dir;
}

describe("SkillLoaderToolService", () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("builds description from enabled skills only", async () => {
    const skillsDir = await createSkillsFixture({
      manifest: `
skills:
  - name: ref-skill
    type: reference
    enabled: true
  - name: hidden-skill
    type: task
    enabled: false
`,
      skills: [
        {
          name: "ref-skill",
          content: `---
description: reference description
---
Reference body
`,
        },
        {
          name: "hidden-skill",
          content: `---
description: hidden description
---
Hidden body
`,
        },
      ],
    });
    tempDirs.push(skillsDir);

    const service = new SkillLoaderToolService({ skillsDir });
    await service.init();

    expect(service.description).toContain("<available_skills>");
    expect(service.description).toContain("<name>ref-skill</name>");
    expect(service.description).toContain("<type>reference</type>");
    expect(service.description).not.toContain("hidden-skill");
  });

  it("returns reference instructions without invoking task runner", async () => {
    const skillsDir = await createSkillsFixture({
      manifest: `
skills:
  - name: ref-skill
    type: reference
    enabled: true
`,
      skills: [
        {
          name: "ref-skill",
          content: `---
description: reference description
---
Reference body
`,
        },
      ],
    });
    tempDirs.push(skillsDir);

    const service = new SkillLoaderToolService({ skillsDir });
    const result = await service.execute({
      skill_name: "ref-skill",
      task_context: "",
    });

    expect(result).toContain("<skill_instructions>");
    expect(result).toContain("Reference body");
    expect(result).toContain("<sandbox_execution_directive>");
  });

  it("returns guidance when task skill is missing task_context", async () => {
    const skillsDir = await createSkillsFixture({
      manifest: `
skills:
  - name: task-skill
    type: task
    enabled: true
`,
      skills: [
        {
          name: "task-skill",
          content: `---
description: task description
---
Task body
`,
        },
      ],
    });
    tempDirs.push(skillsDir);

    const service = new SkillLoaderToolService({ skillsDir });
    const result = await service.execute({
      skill_name: "task-skill",
      task_context: "",
    });

    expect(result).toContain("这是任务型 Skill");
    expect(result).toContain("Task body");
  });

  it("invokes task runner dependencies for task skills", async () => {
    const skillsDir = await createSkillsFixture({
      manifest: `
skills:
  - name: task-skill
    type: task
    enabled: true
`,
      skills: [
        {
          name: "task-skill",
          content: `---
description: task description
---
Task body
`,
        },
      ],
    });
    tempDirs.push(skillsDir);

    const agentRunner = mock(
      async ({
        tools,
        systemPrompt,
        taskContext,
      }: {
        tools: unknown[];
        systemPrompt: string;
        taskContext: string;
      }) => {
        expect(tools).toEqual(["sandbox_tool"]);
        expect(systemPrompt).toContain("Task body");
        expect(systemPrompt).toContain("执行要求");
        expect(taskContext).toBe("完成任务");
        return "task runner ok";
      },
    );

    const service = new SkillLoaderToolService({
      skillsDir,
    });

    const result = await service.execute({
      skill_name: "task-skill",
      task_context: "完成任务",
    });

    expect(result).toBe("task runner ok");
    expect(agentRunner).toHaveBeenCalledTimes(1);
  });

  it("returns clear error for unknown skill", async () => {
    const skillsDir = await createSkillsFixture({
      manifest: "skills: []\n",
    });
    tempDirs.push(skillsDir);

    const service = new SkillLoaderToolService({ skillsDir });
    const result = await service.execute({
      skill_name: "missing-skill",
      task_context: "",
    });

    expect(result).toContain("未找到 Skill 'missing-skill'");
    expect(result).toContain("[]");
  });

  it("stores initialization failure in description when manifest is invalid", async () => {
    const skillsDir = await createSkillsFixture({
      manifest: "skills:\n  - name: broken\n    type: [\n",
    });
    tempDirs.push(skillsDir);

    const service = new SkillLoaderToolService({ skillsDir });
    await service.init();

    expect(service.description).toContain("初始化失败");
  });
});

describe("SkillInstructionsStore", () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("caches instructions after the first read", async () => {
    const skillsDir = await createSkillsFixture({
      manifest: "skills: []\n",
      skills: [
        {
          name: "cache-skill",
          content: `---
description: cached skill
---
First body
`,
        },
      ],
    });
    tempDirs.push(skillsDir);

    const store = new SkillInstructionsStore("/mnt/skills");
    const skillPath = join(skillsDir, "cache-skill");

    const first = await store.get("cache-skill", skillPath);
    await writeFile(
      join(skillPath, "SKILL.md"),
      `---
description: cached skill
---
Second body
`,
      "utf8",
    );
    const second = await store.get("cache-skill", skillPath);

    expect(first).toContain("First body");
    expect(second).toContain("First body");
    expect(second).not.toContain("Second body");
  });
});

describe("createSkillLoaderTool", () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("creates a langchain tool with dynamic description", async () => {
    const skillsDir = await createSkillsFixture({
      manifest: `
skills:
  - name: ref-skill
    type: reference
    enabled: true
`,
      skills: [
        {
          name: "ref-skill",
          content: `---
description: tool description
---
Tool body
`,
        },
      ],
    });
    tempDirs.push(skillsDir);

    const skillLoaderTool = await createSkillLoaderTool({ skillsDir });

    expect(skillLoaderTool.name).toBe("skill_loader");
    expect(skillLoaderTool.description).toContain("<name>ref-skill</name>");
  });
});
