import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Lark from "@larksuiteoapi/node-sdk";

import { CaptureSender, startTestServer } from "./api/index.ts";
import { buildAgentFn } from "./agents/index.ts";
import { CleanupService } from "./cleanup/service.ts";
import { loadXiaopawConfig, type XiaopawConfig } from "./config.ts";
import { CronService } from "./cron/index.ts";
import { FeishuDownloader, FeishuListener, FeishuSender, type FeishuListenerOptions } from "./feishu/index.ts";
import type { AgentFn } from "./runner.ts";
import { Runner } from "./runner.ts";
import { createSessionManager, type SessionManager } from "./session/index.ts";
import { AliyunQwenChatModel } from "../llm/aliyun-qwen-chat-model.ts";
import { startMetricsServer, XiaopawMetricsRegistry } from "./observability/index.ts";
import type { SenderProtocol } from "./models.ts";

const DEFAULT_CONFIG_PATH = "config.yaml";
const DEFAULT_METRICS_HOST = "127.0.0.1";
const DEFAULT_METRICS_PORT = 9100;
const DEFAULT_LISTENER_RETRY_MS = 5_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 86_400_000;

type BunServer = ReturnType<typeof Bun.serve>;

type RuntimeAgentFactoryInput = {
  sender: SenderProtocol;
  config: XiaopawConfig;
  dataDir: string;
  skillsDir: string;
  instructionsDir: string;
};

type RuntimeAgentFactory = (input: RuntimeAgentFactoryInput) => AgentFn;

export type XiaopawRuntimeOptions = {
  configPath?: string;
  config?: XiaopawConfig;
  cwd?: string;
  env?: Record<string, string | undefined>;
  metrics?: XiaopawMetricsRegistry;
  requireQwenApiKey?: boolean;
  listenerRetryMs?: number;
  cleanupIntervalMs?: number;
  agentFactory?: RuntimeAgentFactory;
  larkClientFactory?: (input: {
    appId: string;
    appSecret: string;
    loggerLevel: Lark.LoggerLevel;
  }) => Lark.Client;
  listenerFactory?: (options: FeishuListenerOptions) => Pick<FeishuListener, "start">;
  metricsServerFactory?: typeof startMetricsServer;
  testServerFactory?: typeof startTestServer;
};

export type RuntimeServiceState = {
  metricsServer?: BunServer;
  testServer?: BunServer;
};

export class XiaopawRuntime {
  readonly config: XiaopawConfig;
  readonly dataDir: string;
  readonly sessionManager: SessionManager;
  readonly runner: Runner;
  readonly cronService: CronService;
  readonly metrics: XiaopawMetricsRegistry;
  readonly services: RuntimeServiceState = {};

  private readonly listener: Pick<FeishuListener, "start">;
  private readonly listenerRetryMs: number;
  private readonly cleanupService: CleanupService;
  private readonly cleanupIntervalMs: number;
  private readonly startMetrics: () => BunServer;
  private readonly startTestApi: (() => BunServer) | undefined;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;
  private shuttingDown = false;
  private listenerLoopPromise: Promise<void> | undefined;
  private listenerSleepTimer: ReturnType<typeof setTimeout> | undefined;
  private listenerSleepResolve: (() => void) | undefined;

  constructor(input: {
    config: XiaopawConfig;
    dataDir: string;
    sessionManager: SessionManager;
    runner: Runner;
    cronService: CronService;
    metrics: XiaopawMetricsRegistry;
    listener: Pick<FeishuListener, "start">;
    cleanupService: CleanupService;
    listenerRetryMs: number;
    cleanupIntervalMs: number;
    startMetrics: () => BunServer;
    startTestApi?: () => BunServer;
  }) {
    this.config = input.config;
    this.dataDir = input.dataDir;
    this.sessionManager = input.sessionManager;
    this.runner = input.runner;
    this.cronService = input.cronService;
    this.metrics = input.metrics;
    this.listener = input.listener;
    this.cleanupService = input.cleanupService;
    this.listenerRetryMs = input.listenerRetryMs;
    this.cleanupIntervalMs = input.cleanupIntervalMs;
    this.startMetrics = input.startMetrics;
    this.startTestApi = input.startTestApi;
  }

  async start(): Promise<void> {
    await this.cronService.start();
    this.services.metricsServer = this.startMetrics();
    if (this.startTestApi) {
      this.services.testServer = this.startTestApi();
    }
    this.cleanupTimer = setInterval(() => {
      void this.cleanupService.sweep().catch((error) => {
        console.warn("CleanupService sweep failed:", error);
      });
    }, this.cleanupIntervalMs);
    this.listenerLoopPromise = this.runListenerLoop();
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;

    if (this.listenerSleepTimer) {
      clearTimeout(this.listenerSleepTimer);
      this.listenerSleepTimer = undefined;
    }
    this.listenerSleepResolve?.();
    this.listenerSleepResolve = undefined;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    this.services.testServer?.stop(true);
    this.services.metricsServer?.stop(true);
    await this.cronService.stop();
    await this.runner.shutdown();
    void this.listenerLoopPromise?.catch(() => undefined);
  }

  private async runListenerLoop(): Promise<void> {
    while (!this.shuttingDown) {
      try {
        await this.listener.start();
      } catch (error) {
        if (!this.shuttingDown) {
          console.warn("FeishuListener stopped with error, retrying:", error);
          this.metrics.recordError("feishu_listener", error instanceof Error ? error.name : typeof error);
        }
      }

      if (!this.shuttingDown) {
        await this.sleepBeforeRetry();
      }
    }
  }

  private async sleepBeforeRetry(): Promise<void> {
    await new Promise<void>((resolveSleep) => {
      this.listenerSleepResolve = resolveSleep;
      this.listenerSleepTimer = setTimeout(() => {
        this.listenerSleepTimer = undefined;
        this.listenerSleepResolve = undefined;
        resolveSleep();
      }, this.listenerRetryMs);
    });
  }
}

export async function buildXiaopawRuntime(
  options: XiaopawRuntimeOptions = {},
): Promise<XiaopawRuntime> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const config = options.config ?? await loadRuntimeConfig(options, cwd, env);
  validateRuntimeConfig(config, env, options.requireQwenApiKey ?? !options.agentFactory);

  const dataDir = resolve(cwd, config.data_dir);
  await mkdir(dataDir, { recursive: true });

  const metrics = options.metrics ?? new XiaopawMetricsRegistry();
  const sessionManager = await createSessionManager(dataDir);
  const cleanupService = new CleanupService({ dataDir });
  await cleanupService.writeFeishuCredentials({
    appId: config.feishu.app_id,
    appSecret: config.feishu.app_secret,
  });
  await cleanupService.writeBaiduCredentials({ apiKey: config.baidu.api_key });
  await cleanupService.sweep();

  const loggerLevel = Lark.LoggerLevel.info;
  const client = (options.larkClientFactory ?? defaultLarkClientFactory)({
    appId: config.feishu.app_id,
    appSecret: config.feishu.app_secret,
    loggerLevel,
  });
  const feishuSender = new FeishuSender({
    client,
    maxRetries: config.sender.max_retries,
    retryBackoffMs: config.sender.retry_backoff.map((seconds) => seconds * 1000),
  });
  const downloader = new FeishuDownloader({ client, dataDir });
  const skillsDir = resolveSkillsDir(cwd, config);
  const instructionsDir = resolveInstructionsDir(cwd, config);
  const agentFactory = options.agentFactory ?? createDefaultAgentFactory();
  const agentFn = agentFactory({
    sender: feishuSender,
    config,
    dataDir,
    skillsDir,
    instructionsDir,
  });

  const runner = new Runner({
    sessionManager,
    sender: feishuSender,
    agentFn,
    downloader,
    idleTimeoutMs: config.runner.queue_idle_timeout_s * 1000,
    metrics,
  });

  const cronService = new CronService({
    dataDir,
    dispatchFn: (inbound) => runner.dispatch(inbound),
  });

  const listener = (options.listenerFactory ?? defaultListenerFactory)({
    appId: config.feishu.app_id,
    appSecret: config.feishu.app_secret,
    onMessage: (inbound) => runner.dispatch(inbound),
    allowedChats: config.feishu.allowed_chats.length > 0 ? config.feishu.allowed_chats : null,
    loggerLevel,
    metrics,
  });

  const metricsServerFactory = options.metricsServerFactory ?? startMetricsServer;
  const testServerFactory = options.testServerFactory ?? startTestServer;
  const runtimeInput: ConstructorParameters<typeof XiaopawRuntime>[0] = {
    config,
    dataDir,
    sessionManager,
    runner,
    cronService,
    metrics,
    listener,
    cleanupService,
    listenerRetryMs: options.listenerRetryMs ?? DEFAULT_LISTENER_RETRY_MS,
    cleanupIntervalMs: options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
    startMetrics: () =>
      metricsServerFactory({
        host: DEFAULT_METRICS_HOST,
        port: DEFAULT_METRICS_PORT,
        registry: metrics,
      }),
  };

  if (config.debug.enable_test_api) {
    const captureSender = new CaptureSender();
    const debugAgentFn = agentFactory({
      sender: captureSender,
      config,
      dataDir,
      skillsDir,
      instructionsDir,
    });
    const debugRunner = new Runner({
      sessionManager,
      sender: captureSender,
      agentFn: debugAgentFn,
      idleTimeoutMs: config.runner.queue_idle_timeout_s * 1000,
      metrics,
    });
    runtimeInput.startTestApi = () =>
      testServerFactory({
        runner: debugRunner,
        sender: captureSender,
        sessionManager,
        workspaceDir: resolve(dataDir, "workspace"),
        metrics,
        host: config.debug.test_api_host,
        port: config.debug.test_api_port,
      });
  }

  return new XiaopawRuntime(runtimeInput);
}

export async function asyncMain(): Promise<void> {
  let runtime: XiaopawRuntime | undefined;
  try {
    runtime = await buildXiaopawRuntime();
    await runtime.start();
    console.log(
      [
        "XiaoPaw TypeScript 服务已启动。",
        `data_dir=${runtime.dataDir}`,
        `metrics=http://${DEFAULT_METRICS_HOST}:${DEFAULT_METRICS_PORT}/metrics`,
        runtime.config.debug.enable_test_api
          ? `test_api=http://${runtime.config.debug.test_api_host}:${runtime.config.debug.test_api_port}/api/test/message`
          : "test_api=disabled",
      ].join("\n"),
    );
    await waitForShutdownSignal(runtime);
  } catch (error) {
    console.error(formatStartupError(error));
    await runtime?.shutdown();
    process.exitCode = 1;
  }
}

export function resolveConfigPath(
  argv: readonly string[] = process.argv,
  env: Record<string, string | undefined> = process.env,
): string {
  const configFlagIndex = argv.indexOf("--config");
  if (configFlagIndex >= 0) {
    const value = argv[configFlagIndex + 1];
    if (!value) {
      throw new Error("--config 需要跟随配置文件路径");
    }
    return value;
  }
  return env["XIAOPAW_CONFIG"] || DEFAULT_CONFIG_PATH;
}

export function validateRuntimeConfig(
  config: XiaopawConfig,
  env: Record<string, string | undefined> = process.env,
  requireQwenApiKey = true,
): void {
  const missing: string[] = [];
  if (!config.feishu.app_id) {
    missing.push("feishu.app_id");
  }
  if (!config.feishu.app_secret) {
    missing.push("feishu.app_secret");
  }
  if (requireQwenApiKey && !env["QWEN_API_KEY"] && !env["DASHSCOPE_API_KEY"]) {
    missing.push("QWEN_API_KEY 或 DASHSCOPE_API_KEY");
  }
  if (missing.length > 0) {
    throw new Error(`XiaoPaw 配置不完整，缺少：${missing.join(", ")}`);
  }
}

function createDefaultAgentFactory(): RuntimeAgentFactory {
  return ({ sender, config, dataDir, skillsDir, instructionsDir }) => {
    return buildAgentFn({
      sender,
      model: new AliyunQwenChatModel({
        model: config.agent.model,
        temperature: 0.3,
        timeout: config.agent.timeout_s * 1000,
      }),
      maxHistoryTurns: config.session.max_history_turns,
      skillsDir,
      instructionsDir,
      sandboxMcpUrl: config.sandbox.url,
      sandboxSkillsMount: "/mnt/skills",
      workspaceRoot: config.sandbox.workspace_dir,
      subAgentModel: config.agent.sub_agent_model,
      subAgentMaxIter: config.agent.sub_agent_max_iter,
      agentLogDir: resolve(dataDir, "traces"),
      agentLogFormat: "jsonl",
    });
  };
}

function defaultLarkClientFactory(input: {
  appId: string;
  appSecret: string;
  loggerLevel: Lark.LoggerLevel;
}): Lark.Client {
  return new Lark.Client({
    appId: input.appId,
    appSecret: input.appSecret,
    loggerLevel: input.loggerLevel,
  });
}

function defaultListenerFactory(
  options: FeishuListenerOptions,
): Pick<FeishuListener, "start"> {
  return new FeishuListener(options);
}

async function loadConfigWithContext(
  configPath: string,
  env: Record<string, string | undefined>,
): Promise<XiaopawConfig> {
  try {
    return await loadXiaopawConfig(configPath, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `无法加载 XiaoPaw 配置：${message}`,
        `请确认配置文件存在：${configPath}`,
        "可通过 --config <path> 或 XIAOPAW_CONFIG 指定路径。",
      ].join("\n"),
    );
  }
}

async function loadRuntimeConfig(
  options: XiaopawRuntimeOptions,
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<XiaopawConfig> {
  const configPath = resolve(cwd, options.configPath ?? resolveConfigPath(process.argv, env));
  return loadConfigWithContext(configPath, env);
}

function resolveSkillsDir(cwd: string, config: XiaopawConfig): string {
  const configured = resolve(cwd, config.skills.local_dir);
  if (config.skills.local_dir !== "./skills") {
    return configured;
  }
  return fileURLToPath(new URL("../skills/", import.meta.url));
}

function resolveInstructionsDir(cwd: string, config: XiaopawConfig): string {
  return resolve(cwd, config.instructions_dir);
}

function formatStartupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `XiaoPaw 启动失败：\n${message}`;
}

async function waitForShutdownSignal(runtime: XiaopawRuntime): Promise<void> {
  await new Promise<void>((resolveSignal) => {
    let handled = false;
    const shutdown = (signal: NodeJS.Signals) => {
      if (handled) {
        return;
      }
      handled = true;
      console.log(`收到 ${signal}，正在关闭 XiaoPaw...`);
      void runtime.shutdown().finally(resolveSignal);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  await asyncMain();
}
