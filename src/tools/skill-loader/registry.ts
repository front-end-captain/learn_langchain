import { fileURLToPath } from "node:url";
import {
  DEFAULT_SKILLS_DIR,
  skillManifestSchema,
  type SkillManifest,
  type SkillMeta,
  type SkillRegistryEntry,
  type SkillType,
} from "./types.ts";

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---(?:\n|$)/;

function normalizeSkillsDir(skillsDir?: string): string {
  if (skillsDir) {
    return skillsDir;
  }

  return fileURLToPath(new URL("../../skills/", import.meta.url));
}

function extractFrontmatterDescription(content: string): string {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) {
    return "";
  }

  const parsed = Bun.YAML.parse(match[1] || "");
  if (!parsed || typeof parsed !== "object") {
    return "";
  }

  const frontmatter = parsed as Record<string, unknown>;
  const description = frontmatter["description"];
  if (typeof description !== "string") {
    return "";
  }

  return description.length > 200
    ? `${description.slice(0, 200)}...`
    : description;
}

export class SkillRegistry {
  readonly skillsDir: string;

  private readonly registry = new Map<string, SkillRegistryEntry>();

  private readonly descriptions = new Map<string, string>();

  constructor(skillsDir: string = DEFAULT_SKILLS_DIR) {
    this.skillsDir = normalizeSkillsDir(skillsDir);
  }

  get entries(): ReadonlyMap<string, SkillRegistryEntry> {
    return this.registry;
  }

  async load(): Promise<void> {
    this.registry.clear();
    this.descriptions.clear();

    const manifest = await this.readManifest();
    for (const skill of manifest.skills) {
      if (skill.enabled === false) {
        continue;
      }

      const skillPath = `${this.skillsDir}/${skill.name}`;
      const skillFile = Bun.file(`${skillPath}/SKILL.md`);
      if (!(await skillFile.exists())) {
        continue;
      }

      const content = await skillFile.text();
      this.registry.set(skill.name, {
        type: skill.type,
        path: skillPath,
      });
      this.descriptions.set(skill.name, extractFrontmatterDescription(content));
    }
  }

  getSkillMeta(skillName: string): SkillMeta | undefined {
    const entry = this.registry.get(skillName);
    if (!entry) {
      return undefined;
    }

    return {
      name: skillName,
      type: entry.type,
      path: entry.path,
      description: this.descriptions.get(skillName) ?? "",
    };
  }

  listSkillNames(): string[] {
    return [...this.registry.keys()];
  }

  buildDescription(context: { sessionDir?: string } = {}): string {
    const sessionDir = context.sessionDir ?? "/workspace/sessions/<session_id>";
    const xmlParts = ["<available_skills>"];

    for (const [name, entry] of this.registry.entries()) {
      const description = this.descriptions.get(name) ?? "";
      xmlParts.push("  <skill>");
      xmlParts.push(`    <name>${name}</name>`);
      xmlParts.push(`    <type>${entry.type}</type>`);
      xmlParts.push(`    <description>${description}</description>`);
      xmlParts.push("  </skill>");
    }

    xmlParts.push("</available_skills>");

    return [
      "⚠️ 重要：这是你唯一的工具。所有能力都必须通过此工具调用，不得直接调用 skill 名称作为工具。",
      "调用方式：skill_loader(skill_name='<名称>', task_context='<任务描述>')",
      "skill_name 必须严格来自下方 XML 列表中的 <name> 值。",
      "task 类型 Skill 的 task_context 必须包含完整任务描述、预期输出格式和 JSON schema。",
      `当前 session 工作目录（沙盒路径）：${sessionDir}/`,
      `  - 输入文件（用户上传）：${sessionDir}/uploads/`,
      `  - 输出文件（Skill 产出）：${sessionDir}/outputs/`,
      "",
      ...xmlParts,
    ].join("\n");
  }

  private async readManifest(): Promise<SkillManifest> {
    const manifestFile = Bun.file(`${this.skillsDir}/load_skills.yaml`);
    if (!(await manifestFile.exists())) {
      return { skills: [] };
    }

    const raw = await manifestFile.text();
    const parsed = Bun.YAML.parse(raw);
    return skillManifestSchema.parse(parsed ?? {});
  }
}

export function createSkillRegistryEntry(
  type: SkillType,
  path: string,
): SkillRegistryEntry {
  return { type, path };
}
