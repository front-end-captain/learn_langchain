import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Lark from "@larksuiteoapi/node-sdk";

import {
  buildXiaopawRuntime,
  resolveConfigPath,
  validateRuntimeConfig,
} from "./main.ts";
import type { AgentFn } from "./runner.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("xiaopaw main runtime", () => {
  it("resolves config path from CLI flag, env and default", () => {
    expect(resolveConfigPath(["bun", "main.ts", "--config", "local.yaml"], {})).toBe("local.yaml");
    expect(resolveConfigPath(["bun", "main.ts"], { XIAOPAW_CONFIG: "env.yaml" })).toBe("env.yaml");
    expect(resolveConfigPath(["bun", "main.ts"], {})).toBe("config.yaml");
    expect(() => resolveConfigPath(["bun", "main.ts", "--config"], {})).toThrow(
      "--config 需要跟随配置文件路径",
    );
  });

  it("reports missing config with startup guidance", async () => {
    const dir = await makeTempDir();
    await expect(
      buildXiaopawRuntime({
        cwd: dir,
        configPath: "missing.yaml",
        env: {},
        requireQwenApiKey: false,
        agentFactory: fakeAgentFactory,
      }),
    ).rejects.toThrow("无法加载 XiaoPaw 配置");
  });

  it("validates required Feishu and Qwen settings", async () => {
    const config = await loadFixtureConfig();
    config.feishu.app_id = "";
    expect(() => validateRuntimeConfig(config, {}, true)).toThrow("feishu.app_id");

    config.feishu.app_id = "cli_test";
    expect(() => validateRuntimeConfig(config, {}, true)).toThrow(
      "QWEN_API_KEY 或 DASHSCOPE_API_KEY",
    );
    expect(() => validateRuntimeConfig(config, {}, false)).not.toThrow();
  });

  it("starts cron, metrics, listener and optional TestAPI, then shuts down", async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, "config.yaml"), fixtureConfigYaml(), "utf8");

    let listenerStarts = 0;
    let metricsStops = 0;
    let testApiStops = 0;

    const runtime = await buildXiaopawRuntime({
      cwd: dir,
      configPath: "config.yaml",
      env: {},
      requireQwenApiKey: false,
      listenerRetryMs: 1_000,
      cleanupIntervalMs: 60_000,
      agentFactory: fakeAgentFactory,
      larkClientFactory: () => fakeLarkClient(),
      listenerFactory: () => ({
        start: async () => {
          listenerStarts += 1;
        },
      }),
      metricsServerFactory: () =>
        fakeServer(() => {
          metricsStops += 1;
        }),
      testServerFactory: () =>
        fakeServer(() => {
          testApiStops += 1;
        }),
    });

    await runtime.start();
    await sleep(10);

    expect(listenerStarts).toBeGreaterThanOrEqual(1);
    expect(runtime.services.metricsServer).toBeDefined();
    expect(runtime.services.testServer).toBeDefined();

    await runtime.shutdown();

    expect(metricsStops).toBe(1);
    expect(testApiStops).toBe(1);
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "xiaopaw-main-test-"));
  tempDirs.push(dir);
  return dir;
}

async function loadFixtureConfig() {
  const dir = await makeTempDir();
  const configPath = join(dir, "config.yaml");
  await writeFile(configPath, fixtureConfigYaml(), "utf8");
  const runtime = await buildXiaopawRuntime({
    cwd: dir,
    configPath,
    env: {},
    requireQwenApiKey: false,
    agentFactory: fakeAgentFactory,
    larkClientFactory: () => fakeLarkClient(),
    listenerFactory: () => ({ start: async () => undefined }),
    metricsServerFactory: () => fakeServer(),
  });
  await runtime.shutdown();
  return runtime.config;
}

function fixtureConfigYaml(): string {
  return [
    "feishu:",
    "  app_id: cli_test",
    "  app_secret: secret_test",
    "baidu:",
    "  api_key: baidu_test",
    "data_dir: ./data",
    "skills:",
    "  local_dir: ./src/skills",
    "sandbox:",
    "  url: http://localhost:8022/mcp",
    "  workspace_dir: /workspace",
    "debug:",
    "  enable_test_api: true",
    "  test_api_host: 127.0.0.1",
    "  test_api_port: 19090",
  ].join("\n");
}

function fakeAgentFactory(): AgentFn {
  return async (userMessage) => `fake reply: ${userMessage}`;
}

function fakeLarkClient(): Lark.Client {
  return {} as Lark.Client;
}

function fakeServer(onStop: () => void = () => undefined): ReturnType<typeof Bun.serve> {
  return {
    stop: () => {
      onStop();
    },
  } as ReturnType<typeof Bun.serve>;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
