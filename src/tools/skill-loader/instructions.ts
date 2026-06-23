const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/;

type SkillInstructionsStoreOptions = {
  sandboxSkillsMount: string;
  sessionId?: string;
  sessionDir?: string;
  routingKey?: string;
};

export class SkillInstructionsStore {
  private readonly cache = new Map<string, string>();

  private readonly sandboxSkillsMount: string;

  private readonly sessionId: string;

  private readonly sessionDir: string;

  private readonly routingKey: string;

  constructor(options: string | SkillInstructionsStoreOptions) {
    if (typeof options === "string") {
      this.sandboxSkillsMount = options;
      this.sessionId = "";
      this.sessionDir = "/workspace/sessions/<session_id>";
      this.routingKey = "";
      return;
    }

    this.sandboxSkillsMount = options.sandboxSkillsMount;
    this.sessionId = options.sessionId ?? "";
    this.sessionDir = options.sessionDir ?? "/workspace/sessions/<session_id>";
    this.routingKey = options.routingKey ?? "";
  }

  async get(skillName: string, skillPath: string): Promise<string> {
    const cached = this.cache.get(skillName);
    if (cached) {
      return cached;
    }

    const content = await Bun.file(`${skillPath}/SKILL.md`).text();
    const stripped = content.replace(FRONTMATTER_PATTERN, "");
    const replaced = replaceSkillPlaceholders(stripped.trimEnd(), {
      skillBase: `${this.sandboxSkillsMount}/${skillName}`,
      sessionId: this.sessionId || "<session_id>",
      sessionDir: this.sessionDir,
    });
    const result = `${escapeRemainingBraces(replaced)}${this.buildSandboxDirective(skillName)}`;

    this.cache.set(skillName, result);
    return result;
  }

  clear(): void {
    this.cache.clear();
  }

  private buildSandboxDirective(skillName: string): string {
    const basePath = `${this.sandboxSkillsMount}/${skillName}`;
    const routingKey = this.routingKey || "<由系统注入，如未显示请联系管理员>";
    return [
      "",
      "",
      "<sandbox_execution_directive>",
      "IMPORTANT:【强制约束】所有脚本和文件操作必须在 MCP 沙盒中执行，禁止直接操作本地文件系统。",
      `此 Skill 资源已挂载至沙盒绝对路径：${basePath}/`,
      `当前 Session 工作目录（沙盒）：${this.sessionDir}/`,
      `  - 用户上传文件：${this.sessionDir}/uploads/（只读访问）`,
      `  - 输出文件目录：${this.sessionDir}/outputs/（读写，所有输出文件写在此处）`,
      `  - 临时文件目录：${this.sessionDir}/tmp/（临时工作区）`,
      `当前用户 routing_key（飞书消息发送目标，feishu_ops 脚本的 --routing_key 参数）：${routingKey}`,
      "",
      "可用沙盒工具及正确用法：",
      "1. sandbox_execute_bash：运行 bash 命令或 Python 脚本。",
      `   - 运行脚本示例：cmd=\"python ${basePath}/scripts/xxx.py 参数\"`,
      "2. sandbox_execute_code：在沙盒中直接执行 Python 或 JavaScript 代码。",
      "3. sandbox_file_operations：统一文件操作，写文件首选工具。",
      '   - 写入文件：action="write", path="文件绝对路径", content="文件完整内容"',
      '   - 读取文件：action="read", path="文件绝对路径"',
      '   - 列出目录：action="list", path="目录绝对路径"',
      "4. sandbox_str_replace_editor：对已有文件做查看、创建和局部替换。",
      "5. sandbox_convert_to_markdown：将 URL 或文件 URI 快速转换为 Markdown 文本。",
      "6. browser_* 系列工具：动态网页、截图、表单和浏览器交互场景使用。",
      "【写文件优先级】sandbox_file_operations(action='write') > sandbox_execute_code > 不建议通过 bash 直接传大段 --content",
      "</sandbox_execution_directive>",
    ].join("\n");
  }
}

function replaceSkillPlaceholders(
  content: string,
  input: { skillBase: string; sessionId: string; sessionDir: string },
): string {
  return content
    .replaceAll("{skill_base}", input.skillBase)
    .replaceAll("{_skill_base}", input.skillBase)
    .replaceAll("{session_id}", input.sessionId)
    .replaceAll("{session_dir}", input.sessionDir);
}

function escapeRemainingBraces(content: string): string {
  return content.replaceAll("{", "{{").replaceAll("}", "}}");
}
