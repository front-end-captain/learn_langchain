import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { expandEnvVars, loadXiaopawConfig } from "./config.ts";

describe("XiaoPaw config", () => {
  let dataDir = "";

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "xiaopaw-config-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("expands ${ENV} variables before parsing yaml", async () => {
    const configPath = join(dataDir, "config.yaml");
    await writeFile(
      configPath,
      [
        "feishu:",
        "  app_id: \"${FEISHU_APP_ID}\"",
        "  app_secret: \"${FEISHU_APP_SECRET}\"",
        "baidu:",
        "  api_key: \"${BAIDU_API_KEY}\"",
      ].join("\n"),
    );

    const config = await loadXiaopawConfig(configPath, {
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret_test",
      BAIDU_API_KEY: "baidu_test",
    });

    expect(config.feishu.app_id).toBe("cli_test");
    expect(config.feishu.app_secret).toBe("secret_test");
    expect(config.baidu.api_key).toBe("baidu_test");
  });

  it("fills defaults for missing optional sections", async () => {
    const configPath = join(dataDir, "config.yaml");
    await writeFile(configPath, "{}");

    const config = await loadXiaopawConfig(configPath, {});

    expect(config.data_dir).toBe("./data");
    expect(config.instructions_dir).toBe("./instructions_dir");
    expect(config.sandbox.url).toBe("http://localhost:8022/mcp");
    expect(config.sandbox.workspace_dir).toBe("/workspace");
    expect(config.debug.enable_test_api).toBe(false);
    expect(config.debug.test_api_host).toBe("127.0.0.1");
    expect(config.debug.test_api_port).toBe(9090);
    expect(config.runner.queue_idle_timeout_s).toBe(300);
    expect(config.session.max_history_turns).toBe(20);
    expect(config.feishu.allowed_chats).toEqual([]);
  });

  it("loads configured values", async () => {
    const configPath = join(dataDir, "config.yaml");
    await writeFile(
      configPath,
      [
        "data_dir: ./runtime",
        "feishu:",
        "  allowed_chats:",
        "    - oc_001",
        "sandbox:",
        "  url: http://sandbox.local/mcp",
        "debug:",
        "  enable_test_api: true",
        "  test_api_host: 0.0.0.0",
        "  test_api_port: 9191",
        "runner:",
        "  queue_idle_timeout_s: 12",
      ].join("\n"),
    );

    const config = await loadXiaopawConfig(configPath, {});

    expect(config.data_dir).toBe("./runtime");
    expect(config.feishu.allowed_chats).toEqual(["oc_001"]);
    expect(config.sandbox.url).toBe("http://sandbox.local/mcp");
    expect(config.debug.enable_test_api).toBe(true);
    expect(config.debug.test_api_host).toBe("0.0.0.0");
    expect(config.debug.test_api_port).toBe(9191);
    expect(config.runner.queue_idle_timeout_s).toBe(12);
  });

  it("expands missing env variables to empty strings", () => {
    expect(expandEnvVars("app=${MISSING_ENV}", {})).toBe("app=");
  });

  it("throws a clear error when config file is missing", async () => {
    const configPath = join(dataDir, "missing.yaml");

    await expect(loadXiaopawConfig(configPath, {})).rejects.toThrow(
      "config.yaml not found",
    );
  });

  it("throws when yaml shape is invalid", async () => {
    const configPath = join(dataDir, "config.yaml");
    await writeFile(configPath, "debug:\n  test_api_port: not-a-number\n");

    await expect(loadXiaopawConfig(configPath, {})).rejects.toThrow();
  });
});
