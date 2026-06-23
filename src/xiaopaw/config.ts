import { parse as parseYaml } from "yaml";
import * as z from "zod";

const configSchema = z.object({
  workspace: z
    .object({
      id: z.string().default("xiaopaw-default"),
      name: z.string().default("XiaoPaw 工作助手"),
    })
    .default({ id: "xiaopaw-default", name: "XiaoPaw 工作助手" }),
  feishu: z
    .object({
      app_id: z.string().default(""),
      app_secret: z.string().default(""),
      encrypt_key: z.string().default(""),
      verification_token: z.string().default(""),
      allowed_chats: z.array(z.string()).default([]),
    })
    .default({
      app_id: "",
      app_secret: "",
      encrypt_key: "",
      verification_token: "",
      allowed_chats: [],
    }),
  baidu: z
    .object({
      api_key: z.string().default(""),
    })
    .default({ api_key: "" }),
  bot: z
    .object({
      loading_message: z.string().default("思考中..."),
      prefix: z.string().default(""),
    })
    .default({ loading_message: "思考中...", prefix: "" }),
  agent: z
    .object({
      model: z.string().default("qwen3.6-max-preview"),
      max_iter: z.number().int().positive().default(50),
      max_input_tokens: z.number().int().positive().default(30_000),
      sub_agent_model: z.string().default("qwen3.6-max-preview"),
      sub_agent_max_iter: z.number().int().positive().default(20),
      timeout_s: z.number().positive().default(300),
    })
    .default({
      model: "qwen3.6-max-preview",
      max_iter: 50,
      max_input_tokens: 30_000,
      sub_agent_model: "qwen3.6-max-preview",
      sub_agent_max_iter: 20,
      timeout_s: 300,
    }),
  skills: z
    .object({
      global_dir: z.string().default("../skills"),
      local_dir: z.string().default("./skills"),
    })
    .default({ global_dir: "../skills", local_dir: "./skills" }),
  sandbox: z
    .object({
      url: z.string().default("http://localhost:8022/mcp"),
      workspace_dir: z.string().default("/workspace"),
      timeout_s: z.number().positive().default(120),
      max_retries: z.number().int().nonnegative().default(2),
    })
    .default({
      url: "http://localhost:8022/mcp",
      workspace_dir: "/workspace",
      timeout_s: 120,
      max_retries: 2,
    }),
  session: z
    .object({
      max_history_turns: z.number().int().positive().default(20),
    })
    .default({ max_history_turns: 20 }),
  runner: z
    .object({
      queue_idle_timeout_s: z.number().positive().default(300),
      max_queue_size: z.number().int().positive().default(10),
    })
    .default({ queue_idle_timeout_s: 300, max_queue_size: 10 }),
  sender: z
    .object({
      max_retries: z.number().int().nonnegative().default(3),
      retry_backoff: z.array(z.number().nonnegative()).default([1, 2, 4]),
    })
    .default({ max_retries: 3, retry_backoff: [1, 2, 4] }),
  data_dir: z.string().default("./data"),
  debug: z
    .object({
      enable_test_api: z.boolean().default(false),
      test_api_port: z.number().int().positive().default(9090),
      test_api_host: z.string().default("127.0.0.1"),
    })
    .default({
      enable_test_api: false,
      test_api_port: 9090,
      test_api_host: "127.0.0.1",
    }),
});

export type XiaopawConfig = z.infer<typeof configSchema>;

export function expandEnvVars(
  text: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return text.replaceAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    return env[name] ?? "";
  });
}

export async function loadXiaopawConfig(
  configPath: string,
  env: Record<string, string | undefined> = process.env,
): Promise<XiaopawConfig> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    throw new Error(`config.yaml not found at ${configPath}`);
  }

  const expanded = expandEnvVars(await file.text(), env);
  const raw = parseYaml(expanded) as unknown;
  return configSchema.parse(raw ?? {});
}
