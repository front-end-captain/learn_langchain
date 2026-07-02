import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function build_bootstrap_prompt(workspace_dir: string): string {
  const parts: string[] = [];
  const bootstrapFiles = [
    ["soul.md", "soul"],
    ["user.md", "user_profile"],
    ["agent.md", "agent_rules"],
  ] as const;

  for (const [filename, tag] of bootstrapFiles) {
    const p = path.resolve(workspace_dir, filename);
    if (existsSync(p)) {
      parts.push(`<${tag}>\n${readFileSync(p, "utf-8").trim()}\n</${tag}>`);
    }
  }

  const memoryPath = path.resolve(workspace_dir, "memory.md");
  if (existsSync(memoryPath)) {
    const lines = readFileSync(memoryPath, "utf-8").split(/\r?\n/).slice(0, 200);
    parts.push(`<memory_index>\n${lines.join("\n")}\n</memory_index>`);
  }

  return parts.join("\n\n");
}
