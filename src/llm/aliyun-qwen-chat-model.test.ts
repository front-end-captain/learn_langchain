import { ToolMessage, HumanMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it } from "bun:test";

import {
  AliyunQwenChatModel,
  convertMessagesToAliyunMessages,
  shouldDebugPayload,
  truncateToolResults,
} from "./aliyun-qwen-chat-model.ts";

describe("AliyunQwenChatModel XiaoPaw defaults", () => {
  const originalQwenApiKey = process.env["QWEN_API_KEY"];
  const originalDashscopeApiKey = process.env["DASHSCOPE_API_KEY"];
  const originalQwenApiBase = process.env["QWEN_API_BASE"];
  const originalDebugPayload = process.env["QWEN_DEBUG_PAYLOAD"];

  afterEach(() => {
    restoreEnv("QWEN_API_KEY", originalQwenApiKey);
    restoreEnv("DASHSCOPE_API_KEY", originalDashscopeApiKey);
    restoreEnv("QWEN_API_BASE", originalQwenApiBase);
    restoreEnv("QWEN_DEBUG_PAYLOAD", originalDebugPayload);
  });

  it("reads api key from QWEN_API_KEY", () => {
    process.env["QWEN_API_KEY"] = "qwen-key";
    Reflect.deleteProperty(process.env, "DASHSCOPE_API_KEY");

    const model = new AliyunQwenChatModel({ model: "qwen-test" });

    expect(model.apiKey).toBe("qwen-key");
  });

  it("falls back to DASHSCOPE_API_KEY", () => {
    Reflect.deleteProperty(process.env, "QWEN_API_KEY");
    process.env["DASHSCOPE_API_KEY"] = "dashscope-key";

    const model = new AliyunQwenChatModel({ model: "qwen-test" });

    expect(model.apiKey).toBe("dashscope-key");
  });

  it("uses default DashScope compatible endpoint", () => {
    process.env["QWEN_API_KEY"] = "qwen-key";
    Reflect.deleteProperty(process.env, "QWEN_API_BASE");

    const model = new AliyunQwenChatModel({ model: "qwen-test" });

    expect(model.apiBase).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
  });

  it("uses QWEN_API_BASE when provided", () => {
    process.env["QWEN_API_KEY"] = "qwen-key";
    process.env["QWEN_API_BASE"] = "https://example.test/v1";

    const model = new AliyunQwenChatModel({ model: "qwen-test" });

    expect(model.apiBase).toBe("https://example.test/v1");
  });

  it("detects QWEN_DEBUG_PAYLOAD", () => {
    expect(shouldDebugPayload({ QWEN_DEBUG_PAYLOAD: "1" })).toBe(true);
    expect(shouldDebugPayload({ QWEN_DEBUG_PAYLOAD: "0" })).toBe(false);
    expect(shouldDebugPayload({})).toBe(false);
  });
});

describe("truncateToolResults", () => {
  it("truncates long tool message content", () => {
    const messages = convertMessagesToAliyunMessages([
      new ToolMessage({
        tool_call_id: "call_001",
        content: "x".repeat(20),
      }),
    ]);

    const truncated = truncateToolResults(messages, 5);

    expect(truncated[0]?.content).toContain("xxxxx");
    expect(truncated[0]?.content).toContain("已截断");
    expect(truncated[0]?.content).toContain("分批处理");
  });

  it("keeps short tool message content unchanged", () => {
    const messages = convertMessagesToAliyunMessages([
      new ToolMessage({ tool_call_id: "call_001", content: "short" }),
    ]);

    expect(truncateToolResults(messages, 10)).toEqual(messages);
  });

  it("does not truncate non-tool messages", () => {
    const messages = convertMessagesToAliyunMessages([
      new HumanMessage("x".repeat(20)),
    ]);

    expect(truncateToolResults(messages, 5)).toEqual(messages);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = value;
  }
}
