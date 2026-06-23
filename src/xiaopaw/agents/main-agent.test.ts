import { FakeListChatModel } from "@langchain/core/utils/testing";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SenderProtocol } from "../models.ts";
import type { MessageEntry } from "../session/models.ts";
import { buildAgentFn, buildUserPrompt, formatHistory } from "./main-agent.ts";

class RecordingSender implements SenderProtocol {
  readonly sent: Array<{ routingKey: string; content: string; rootId: string }> = [];
  shouldFail = false;

  async send(routingKey: string, content: string, rootId: string): Promise<void> {
    if (this.shouldFail) {
      throw new Error("send failed");
    }
    this.sent.push({ routingKey, content, rootId });
  }

  async sendText(): Promise<void> {}

  async sendThinking(): Promise<string | null> {
    return null;
  }

  async updateCard(): Promise<void> {}
}

describe("formatHistory", () => {
  it("returns placeholder for empty history", () => {
    expect(formatHistory([])).toBe("（无历史记录）");
  });

  it("formats user and assistant messages in order", () => {
    const history: MessageEntry[] = [
      { role: "user", content: "question", ts: 1, feishuMsgId: "om_1" },
      { role: "assistant", content: "answer", ts: 2, feishuMsgId: null },
    ];

    const formatted = formatHistory(history);

    expect(formatted).toContain("用户: question");
    expect(formatted).toContain("助手: answer");
    expect(formatted.indexOf("用户")).toBeLessThan(formatted.indexOf("助手"));
  });

  it("truncates old messages and adds history_reader hint", () => {
    const history: MessageEntry[] = Array.from({ length: 5 }, (_, index) => ({
      role: "user" as const,
      content: `msg${index}`,
      ts: index,
      feishuMsgId: null,
    }));

    const formatted = formatHistory(history, 2);

    expect(formatted).toContain("history_reader");
    expect(formatted).toContain("msg4");
    expect(formatted).toContain("msg3");
    expect(formatted).not.toContain("msg0");
  });
});

describe("buildUserPrompt", () => {
  it("does not include session id", () => {
    const prompt = buildUserPrompt({
      userMessage: "hello",
      history: [],
      maxHistoryTurns: 20,
    });

    expect(prompt).toContain("【历史对话】");
    expect(prompt).toContain("【用户消息】");
    expect(prompt).toContain("hello");
    expect(prompt).not.toContain("s-secret-session");
  });
});

describe("buildAgentFn", () => {
  const originalQwenApiKey = process.env["QWEN_API_KEY"];
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (originalQwenApiKey === undefined) {
      Reflect.deleteProperty(process.env, "QWEN_API_KEY");
    } else {
      process.env["QWEN_API_KEY"] = originalQwenApiKey;
    }
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
  });

  it("returns structured reply with a fake model", async () => {
    const model = new FakeListChatModel({
      responses: [JSON.stringify({ reply: "结构化回复", used_skills: [] })],
    });
    const agentFn = buildAgentFn({ model });

    const reply = await agentFn("你好", [], "s-001", "p2p:ou", "om_1", false);

    expect(reply).toBe("结构化回复");
  });

  it("emits stream events through onEvent", async () => {
    const model = new FakeListChatModel({
      responses: [JSON.stringify({ reply: "事件回复", used_skills: [] })],
    });
    const onEvent = mock(() => undefined);
    const agentFn = buildAgentFn({ model, onEvent });

    await agentFn("你好", [], "s-001", "p2p:ou", "om_1", false);

    expect(onEvent).toHaveBeenCalled();
  });

  it("sends verbose stream events and keeps final reply", async () => {
    const model = new FakeListChatModel({
      responses: [JSON.stringify({ reply: "verbose 回复", used_skills: [] })],
    });
    const sender = new RecordingSender();
    const agentFn = buildAgentFn({ model, sender });

    const reply = await agentFn("你好", [], "s-001", "p2p:ou", "om_1", true);

    expect(reply).toBe("verbose 回复");
    expect(sender.sent.length).toBeGreaterThan(0);
    expect(sender.sent[0]?.routingKey).toBe("p2p:ou");
    expect(sender.sent[0]?.rootId).toBe("om_1");
  });

  it("ignores verbose send failures", async () => {
    const model = new FakeListChatModel({
      responses: [JSON.stringify({ reply: "仍然成功", used_skills: [] })],
    });
    const sender = new RecordingSender();
    sender.shouldFail = true;
    const agentFn = buildAgentFn({ model, sender });

    const reply = await agentFn("你好", [], "s-001", "p2p:ou", "om_1", true);

    expect(reply).toBe("仍然成功");
  });

  it("writes agent stream events to file when agentLogDir is provided", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "xiaopaw-agent-logs-"));
    tempDirs.push(logDir);
    const model = new FakeListChatModel({
      responses: [JSON.stringify({ reply: "日志回复", used_skills: [] })],
    });
    const agentFn = buildAgentFn({ model, agentLogDir: logDir });

    const reply = await agentFn("你好", [], "s-001", "p2p:ou", "om_log", false);

    const log = await readFile(join(logDir, "om_log.jsonl"), "utf8");
    expect(reply).toBe("日志回复");
    expect(log).toContain("run_start");
    expect(log).toContain("agent_update");
    expect(log).toContain("run_end");
  });
});
