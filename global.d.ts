declare module "bun" {
  interface Env {
    QWEN_API_KEY: string;
    QWEN_API_BASE: string;
    LARK_APP_ID: string;
    LARK_APP_SECRET: string;
  }
}
