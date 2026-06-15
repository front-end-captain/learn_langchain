const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/;

export class SkillInstructionsStore {
  private readonly cache = new Map<string, string>();

  constructor(private readonly sandboxSkillsMount: string) {}

  async get(skillName: string, skillPath: string): Promise<string> {
    const cached = this.cache.get(skillName);
    if (cached) {
      return cached;
    }

    const content = await Bun.file(`${skillPath}/SKILL.md`).text();
    const stripped = content.replace(FRONTMATTER_PATTERN, "");
    const result = `${stripped.trimEnd()}${this.buildSandboxDirective(skillName)}`;

    this.cache.set(skillName, result);
    return result;
  }

  clear(): void {
    this.cache.clear();
  }

  private buildSandboxDirective(skillName: string): string {
    const basePath = `${this.sandboxSkillsMount}/${skillName}`;
    return [
      "",
      "",
      "<sandbox_execution_directive>",
      "IMPORTANT:【强制约束】所有脚本和文件操作必须在 MCP 沙盒中执行，禁止直接操作本地文件系统。",
      `此 Skill 资源已挂载至沙盒绝对路径：${basePath}/`,
      "",
      "可用沙盒工具及正确用法：",
      "1. sandbox_file_operations：统一文件操作，写文件首选工具。",
      '   - 写入文件：action="write", path="文件绝对路径", content="文件完整内容"',
      '   - 读取文件：action="read", path="文件绝对路径"',
      '   - 列出目录：action="list", path="目录绝对路径"',
      '   - 查找文件：action="find", path="目录绝对路径", pattern="*.md"',
      "2. sandbox_execute_bash：运行脚本、安装依赖、执行系统命令。",
      `   - 运行脚本示例：cmd="python ${basePath}/scripts/xxx.py 参数"`,
      "3. sandbox_execute_code：当需要安全写入大段文本时，可用 Python 或 JavaScript 代码片段写文件。",
      "4. sandbox_str_replace_editor：对已有文件做查看、创建和局部替换。",
      "",
      "【写文件优先级】sandbox_file_operations(action='write') > sandbox_execute_code > 不建议通过 bash 直接传大段 --content",
      "</sandbox_execution_directive>",
    ].join("\n");
  }
}
