import type { Dirent } from "node:fs";
import {
  chmod,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface CleanupPolicy {
  rules: Record<string, number>;
  sessionJsonlRetentionDays: number;
}

export const DEFAULT_CLEANUP_POLICY: CleanupPolicy = {
  rules: {
    "workspace/sessions/*/tmp": 1,
    "workspace/sessions/*/uploads": 7,
    "workspace/sessions/*/outputs": 30,
    traces: 30,
  },
  sessionJsonlRetentionDays: 365,
};

type CleanupServiceOptions = {
  dataDir: string;
  policy?: CleanupPolicy;
};

class AsyncLock {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    const current = new Promise<void>((resolveCurrent) => {
      release = resolveCurrent;
    });
    this.tail = previous.then(() => current, () => current);

    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class CleanupService {
  private readonly dataDir: string;
  private readonly policy: CleanupPolicy;
  private readonly lock = new AsyncLock();

  constructor(options: CleanupServiceOptions) {
    this.dataDir = resolve(options.dataDir);
    this.policy = options.policy ?? DEFAULT_CLEANUP_POLICY;
  }

  async sweep(): Promise<Record<string, number>> {
    return this.lock.runExclusive(async () => {
      const stats: Record<string, number> = {};
      const nowMs = Date.now();

      for (const [pattern, days] of Object.entries(this.policy.rules)) {
        const cutoffMs = nowMs - days * 86_400_000;
        let count = 0;
        const targets = await this.expandTargets(pattern);
        for (const target of targets) {
          count += await cleanDirectoryContents(target, cutoffMs);
        }
        stats[pattern] = count;
      }

      stats["sessions/*.jsonl"] = await this.cleanSessionJsonl(nowMs);
      return stats;
    });
  }

  async ensureWorkspaceDirs(sessionId: string): Promise<void> {
    const base = join(this.dataDir, "workspace", "sessions", sessionId);
    await Promise.all(
      ["uploads", "outputs", "tmp"].map((subdir) =>
        mkdir(join(base, subdir), { recursive: true }),
      ),
    );
  }

  async writeFeishuCredentials(input: {
    appId: string;
    appSecret: string;
  }): Promise<void> {
    await this.writeCredentialFile(
      "feishu.json",
      { app_id: input.appId, app_secret: input.appSecret },
    );
  }

  async writeBaiduCredentials(input: { apiKey: string }): Promise<void> {
    if (!input.apiKey) {
      return;
    }
    await this.writeCredentialFile("baidu.json", { api_key: input.apiKey });
  }

  private async expandTargets(pattern: string): Promise<string[]> {
    const segments = pattern.split("/").filter((segment) => segment.length > 0);
    let current = [this.dataDir];

    for (const segment of segments) {
      const next: string[] = [];
      for (const base of current) {
        if (segment === "*") {
          for (const child of await safeReadDir(base)) {
            if (child.isDirectory()) {
              next.push(join(base, child.name));
            }
          }
        } else {
          const candidate = join(base, segment);
          if (await isDirectory(candidate)) {
            next.push(candidate);
          }
        }
      }
      current = next;
      if (current.length === 0) {
        break;
      }
    }

    return current;
  }

  private async cleanSessionJsonl(nowMs: number): Promise<number> {
    const sessionDir = join(this.dataDir, "sessions");
    const cutoffMs = nowMs - this.policy.sessionJsonlRetentionDays * 86_400_000;
    let count = 0;

    for (const child of await safeReadDir(sessionDir)) {
      if (!child.isFile() || !child.name.endsWith(".jsonl")) {
        continue;
      }
      const filePath = join(sessionDir, child.name);
      try {
        const fileStat = await stat(filePath);
        if (fileStat.mtimeMs < cutoffMs) {
          await rm(filePath, { force: true });
          count += 1;
        }
      } catch (error) {
        console.warn(`cleanup: failed to remove ${filePath}`, error);
      }
    }

    return count;
  }

  private async writeCredentialFile(
    fileName: string,
    data: Record<string, string>,
  ): Promise<void> {
    const configDir = join(this.dataDir, "workspace", ".config");
    await mkdir(configDir, { recursive: true });
    await chmod(configDir, 0o700);

    const targetPath = join(configDir, fileName);
    const tmpPath = `${targetPath}.tmp`;
    await mkdir(dirname(tmpPath), { recursive: true });
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
    await chmod(tmpPath, 0o600);
    await rename(tmpPath, targetPath);
    await chmod(targetPath, 0o600);
  }
}

async function cleanDirectoryContents(targetDir: string, cutoffMs: number): Promise<number> {
  if (!(await isDirectory(targetDir))) {
    return 0;
  }

  let count = 0;
  for (const child of await safeReadDir(targetDir)) {
    const childPath = join(targetDir, child.name);
    try {
      const childStat = await stat(childPath);
      if (childStat.mtimeMs >= cutoffMs) {
        continue;
      }
      await rm(childPath, { recursive: true, force: true });
      count += 1;
    } catch (error) {
      console.warn(`cleanup: failed to remove ${childPath}`, error);
    }
  }
  return count;
}

async function safeReadDir(path: string): Promise<Dirent<string>[]> {
  try {
    return await readdir(path, { encoding: "utf8", withFileTypes: true });
  } catch {
    return [];
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
