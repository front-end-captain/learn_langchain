import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { CleanupService, type CleanupPolicy } from "./service.ts";

describe("CleanupService", () => {
  let dataDir = "";

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "xiaopaw-cleanup-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function makeService(policy?: CleanupPolicy): CleanupService {
    const options: { dataDir: string; policy?: CleanupPolicy } = { dataDir };
    if (policy) {
      options.policy = policy;
    }
    return new CleanupService(options);
  }

  it("removes old tmp files and keeps recent files", async () => {
    const service = makeService({
      rules: { "workspace/sessions/*/tmp": 1 },
      sessionJsonlRetentionDays: 365,
    });
    const oldFile = join(dataDir, "workspace", "sessions", "s-001", "tmp", "old.txt");
    const newFile = join(dataDir, "workspace", "sessions", "s-001", "tmp", "new.txt");
    await writeAgedFile(oldFile, 2);
    await writeAgedFile(newFile, 0);

    const stats = await service.sweep();

    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(newFile)).toBe(true);
    expect(stats["workspace/sessions/*/tmp"]).toBe(1);
  });

  it("removes old subdirectories but preserves matched target directory", async () => {
    const service = makeService({
      rules: { "workspace/sessions/*/tmp": 1 },
      sessionJsonlRetentionDays: 365,
    });
    const targetDir = join(dataDir, "workspace", "sessions", "s-001", "tmp");
    const oldDir = join(targetDir, "old-dir");
    await mkdir(oldDir, { recursive: true });
    await writeFile(join(oldDir, "item.txt"), "old");
    await setAge(oldDir, 2);

    const stats = await service.sweep();

    expect(existsSync(targetDir)).toBe(true);
    expect(existsSync(oldDir)).toBe(false);
    expect(stats["workspace/sessions/*/tmp"]).toBe(1);
  });

  it("removes old session jsonl files", async () => {
    const service = makeService({ rules: {}, sessionJsonlRetentionDays: 30 });
    const oldFile = join(dataDir, "sessions", "s-old.jsonl");
    const newFile = join(dataDir, "sessions", "s-new.jsonl");
    await writeAgedFile(oldFile, 31);
    await writeAgedFile(newFile, 0);

    const stats = await service.sweep();

    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(newFile)).toBe(true);
    expect(stats["sessions/*.jsonl"]).toBe(1);
  });

  it("sweeps empty data dir without throwing", async () => {
    const service = makeService();

    const stats = await service.sweep();

    expect(typeof stats).toBe("object");
    expect(stats["sessions/*.jsonl"]).toBe(0);
  });

  it("creates required workspace subdirectories idempotently", async () => {
    const service = makeService();

    await service.ensureWorkspaceDirs("s-001");
    await service.ensureWorkspaceDirs("s-001");

    const base = join(dataDir, "workspace", "sessions", "s-001");
    expect(existsSync(join(base, "uploads"))).toBe(true);
    expect(existsSync(join(base, "outputs"))).toBe(true);
    expect(existsSync(join(base, "tmp"))).toBe(true);
  });

  it("writes feishu credentials atomically with private permissions", async () => {
    const service = makeService();

    await service.writeFeishuCredentials({ appId: "cli_test", appSecret: "secret" });

    const configDir = join(dataDir, "workspace", ".config");
    const credsPath = join(configDir, "feishu.json");
    const creds = JSON.parse(await readFile(credsPath, "utf8")) as Record<string, unknown>;
    expect(creds).toEqual({ app_id: "cli_test", app_secret: "secret" });
    expect(existsSync(`${credsPath}.tmp`)).toBe(false);
    await expectMode(configDir, 0o700);
    await expectMode(credsPath, 0o600);
  });

  it("overwrites existing feishu credentials", async () => {
    const service = makeService();

    await service.writeFeishuCredentials({ appId: "old", appSecret: "old-secret" });
    await service.writeFeishuCredentials({ appId: "new", appSecret: "new-secret" });

    const credsPath = join(dataDir, "workspace", ".config", "feishu.json");
    const creds = JSON.parse(await readFile(credsPath, "utf8")) as Record<string, unknown>;
    expect(creds).toEqual({ app_id: "new", app_secret: "new-secret" });
  });

  it("writes baidu credentials and skips empty api key", async () => {
    const service = makeService();
    const credsPath = join(dataDir, "workspace", ".config", "baidu.json");

    await service.writeBaiduCredentials({ apiKey: "" });
    expect(existsSync(credsPath)).toBe(false);

    await service.writeBaiduCredentials({ apiKey: "key-123" });
    const creds = JSON.parse(await readFile(credsPath, "utf8")) as Record<string, unknown>;
    expect(creds).toEqual({ api_key: "key-123" });
    expect(existsSync(`${credsPath}.tmp`)).toBe(false);
    await expectMode(join(dataDir, "workspace", ".config"), 0o700);
    await expectMode(credsPath, 0o600);
  });

  it("overwrites existing baidu credentials", async () => {
    const service = makeService();

    await service.writeBaiduCredentials({ apiKey: "old-key" });
    await service.writeBaiduCredentials({ apiKey: "new-key" });

    const credsPath = join(dataDir, "workspace", ".config", "baidu.json");
    const creds = JSON.parse(await readFile(credsPath, "utf8")) as Record<string, unknown>;
    expect(creds).toEqual({ api_key: "new-key" });
  });
});

async function writeAgedFile(path: string, ageDays: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "data");
  await setAge(path, ageDays);
}

async function setAge(path: string, ageDays: number): Promise<void> {
  const oldDate = new Date(Date.now() - ageDays * 86_400_000);
  await utimes(path, oldDate, oldDate);
}

async function expectMode(path: string, expected: number): Promise<void> {
  const mode = (await stat(path)).mode & 0o777;
  expect(mode).toBe(expected);
}
