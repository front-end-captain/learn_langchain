import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import type { Attachment, InboundMessage, SenderProtocol } from "./models.ts";
import { CaptureSender } from "./api/capture-sender.ts";
import { XiaopawMetricsRegistry } from "./observability/metrics.ts";
import { buildAttachmentMessage, Runner, type AgentFn } from "./runner.ts";
import { createSessionManager, type SessionManager } from "./session/manager.ts";

class RecordingSender implements SenderProtocol {
  readonly sent: Array<{ routingKey: string; content: string; rootId: string }> = [];
  readonly text: Array<{ routingKey: string; content: string; rootId: string }> = [];
  readonly thinking: Array<{ routingKey: string; rootId: string }> = [];
  readonly updated: Array<{ cardMsgId: string; content: string }> = [];

  cardMsgId: string | null = "card_001";
  updateShouldFail = false;

  async send(routingKey: string, content: string, rootId: string): Promise<void> {
    this.sent.push({ routingKey, content, rootId });
  }

  async sendText(
    routingKey: string,
    content: string,
    rootId: string,
  ): Promise<void> {
    this.text.push({ routingKey, content, rootId });
  }

  async sendThinking(routingKey: string, rootId: string): Promise<string | null> {
    this.thinking.push({ routingKey, rootId });
    return this.cardMsgId;
  }

  async updateCard(cardMsgId: string, content: string): Promise<void> {
    if (this.updateShouldFail) {
      throw new Error("patch failed");
    }
    this.updated.push({ cardMsgId, content });
  }
}

function inbound(content: string, input: Partial<InboundMessage> = {}): InboundMessage {
  const message: InboundMessage = {
    routingKey: input.routingKey ?? "p2p:ou_user",
    content,
    msgId: input.msgId ?? `om_${crypto.randomUUID()}`,
    rootId: input.rootId ?? "om_root",
    senderId: input.senderId ?? "ou_user",
    ts: input.ts ?? Date.now(),
  };
  if (input.isCron !== undefined) {
    message.isCron = input.isCron;
  }
  if (input.attachment !== undefined) {
    message.attachment = input.attachment;
  }
  return message;
}

describe("buildAttachmentMessage", () => {
  it("builds the same attachment hint as Python runner", () => {
    expect(buildAttachmentMessage("/workspace/a.pdf", "请总结")).toContain(
      "用户备注：请总结",
    );
    expect(buildAttachmentMessage("/workspace/a.pdf", "")).not.toContain(
      "用户备注",
    );
  });
});

describe("Runner", () => {
  let dataDir = "";
  let sessionManager: SessionManager;
  let sender: RecordingSender;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "xiaopaw-runner-"));
    sessionManager = await createSessionManager(dataDir);
    sender = new RecordingSender();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("handles slash commands without entering agent or history", async () => {
    const agentFn = mock(async () => "should not run");
    const runner = new Runner({
      sessionManager,
      sender,
      agentFn,
      idleTimeoutMs: 10,
    });

    await runner.dispatch(inbound("/help"));
    await waitFor(() => sender.text.length === 1);

    expect(sender.text[0]?.content).toContain("/new");
    expect(agentFn).not.toHaveBeenCalled();
    const session = await sessionManager.getOrCreate("p2p:ou_user");
    expect(await sessionManager.loadHistory(session.id)).toEqual([]);
  });

  it("creates sessions and toggles verbose with slash commands", async () => {
    const runner = new Runner({
      sessionManager,
      sender,
      agentFn: async () => "unused",
      idleTimeoutMs: 10,
    });

    await runner.dispatch(inbound("/verbose on"));
    await waitFor(() => sender.text.length === 1);

    let session = await sessionManager.getOrCreate("p2p:ou_user");
    expect(session.verbose).toBe(true);
    expect(sender.text[0]?.content).toContain("详细模式已开启");

    await runner.dispatch(inbound("/verbose"));
    await waitFor(() => sender.text.length === 2);
    expect(sender.text[1]?.content).toBe("当前详细模式：开启");

    await runner.dispatch(inbound("/verbose off"));
    await waitFor(() => sender.text.length === 3);
    session = await sessionManager.getOrCreate("p2p:ou_user");
    expect(session.verbose).toBe(false);
    expect(sender.text[2]?.content).toContain("详细模式已关闭");
  });

  it("creates a new active session with /new", async () => {
    const runner = new Runner({
      sessionManager,
      sender,
      agentFn: async () => "unused",
      idleTimeoutMs: 10,
    });
    const first = await sessionManager.getOrCreate("p2p:ou_user");

    await runner.dispatch(inbound("/new"));
    await waitFor(() => sender.text.length === 1);

    const second = await sessionManager.getOrCreate("p2p:ou_user");
    expect(second.id).not.toBe(first.id);
    expect(sender.text[0]?.content).toContain(`已创建新对话 ${second.id}`);
  });

  it("reports current session status with /status", async () => {
    const runner = new Runner({
      sessionManager,
      sender,
      agentFn: async () => "unused",
      idleTimeoutMs: 10,
    });
    const session = await sessionManager.getOrCreate("p2p:ou_user");

    await runner.dispatch(inbound("/status"));
    await waitFor(() => sender.text.length === 1);

    expect(sender.text[0]?.content).toContain(`当前对话：${session.id}`);
    expect(sender.text[0]?.content).toContain("消息数：0");
    expect(sender.text[0]?.content).toContain("详细模式：关闭");
  });

  it("passes unknown slash commands to agent", async () => {
    const agentFn = mock<AgentFn>(async (message) => `reply:${message}`);
    const runner = new Runner({
      sessionManager,
      sender,
      agentFn,
      idleTimeoutMs: 10,
    });

    await runner.dispatch(inbound("/unknown command"));
    await waitFor(() => sender.updated.length === 1);

    expect(agentFn).toHaveBeenCalledTimes(1);
    expect(sender.text).toHaveLength(0);
    expect(sender.updated[0]?.content).toBe("reply:/unknown command");
  });

  it("runs agent, appends history, and updates thinking card", async () => {
    const agentFn = mock<AgentFn>(
      async (userMessage, history, sessionId, routingKey, rootId, verbose) => {
        expect(userMessage).toBe("你好");
        expect(history).toEqual([]);
        expect(sessionId).toStartWith("s-");
        expect(routingKey).toBe("p2p:ou_user");
        expect(rootId).toBe("om_root");
        expect(verbose).toBe(false);
        return "你好呀";
      },
    );
    const runner = new Runner({ sessionManager, sender, agentFn, idleTimeoutMs: 10 });

    await runner.dispatch(inbound("你好"));
    await waitFor(() => sender.updated.length === 1);

    expect(sender.thinking).toHaveLength(1);
    expect(sender.updated[0]).toEqual({ cardMsgId: "card_001", content: "你好呀" });
    expect(agentFn).toHaveBeenCalledTimes(1);

    const session = await sessionManager.getOrCreate("p2p:ou_user");
    const history = await sessionManager.loadHistory(session.id);
    expect(history.map((item) => item.content)).toEqual(["你好", "你好呀"]);
  });

  it("passes previous history to the next agent invocation", async () => {
    const seenHistory: string[][] = [];
    const agentFn: AgentFn = async (userMessage, history) => {
      seenHistory.push(history.map((entry) => `${entry.role}:${entry.content}`));
      return `reply:${userMessage}`;
    };
    const runner = new Runner({ sessionManager, sender, agentFn, idleTimeoutMs: 10 });

    await runner.dispatch(inbound("first", { msgId: "om_1" }));
    await waitFor(() => sender.updated.length === 1);
    await runner.dispatch(inbound("second", { msgId: "om_2" }));
    await waitFor(() => sender.updated.length === 2);

    expect(seenHistory).toEqual([
      [],
      ["user:first", "assistant:reply:first"],
    ]);
  });

  it("runs a local full chain with CaptureSender", async () => {
    const captureSender = new CaptureSender();
    const runner = new Runner({
      sessionManager,
      sender: captureSender,
      agentFn: async (userMessage, history, sessionId) => {
        return [`收到消息：${userMessage}`, `session=${sessionId}`, `history=${history.length}`].join("\n");
      },
      idleTimeoutMs: 10,
    });
    const msgId = "om_capture";
    const replyPromise = captureSender.register(msgId);

    await runner.dispatch(inbound("本地闭环", { msgId, rootId: msgId }));

    const reply = await replyPromise;
    expect(reply).toContain("收到消息：本地闭环");
    expect(reply).toContain("session=s-");
    expect(reply).toContain("history=0");
  });

  it("sends final reply directly when thinking card is unavailable", async () => {
    sender.cardMsgId = null;
    const runner = new Runner({
      sessionManager,
      sender,
      agentFn: async () => "direct reply",
      idleTimeoutMs: 10,
    });

    await runner.dispatch(inbound("你好"));
    await waitFor(() => sender.sent.length === 1);

    expect(sender.updated).toHaveLength(0);
    expect(sender.sent[0]).toEqual({
      routingKey: "p2p:ou_user",
      content: "direct reply",
      rootId: "om_root",
    });
  });

  it("sends an error message when agent fails", async () => {
    const runner = new Runner({
      sessionManager,
      sender,
      agentFn: async () => {
        throw new Error("agent failed");
      },
      idleTimeoutMs: 10,
    });

    await runner.dispatch(inbound("你好"));
    await waitFor(() => sender.sent.length === 1);

    expect(sender.sent[0]).toEqual({
      routingKey: "p2p:ou_user",
      content: "处理出错，请稍后重试。",
      rootId: "om_root",
    });
    expect(sender.updated).toHaveLength(0);
  });

  it("records runner queue, worker and error metrics without changing behavior", async () => {
    const metrics = new XiaopawMetricsRegistry();
    const runner = new Runner({
      sessionManager,
      sender,
      metrics,
      agentFn: async () => {
        throw new Error("agent failed");
      },
      idleTimeoutMs: 10,
    });

    await runner.dispatch(inbound("你好"));
    await waitFor(() => sender.sent.length === 1);

    const exported = metrics.exportMetrics();
    expect(exported).toContain("xiaopaw_runner_queue_size");
    expect(exported).toContain("xiaopaw_runner_workers_active");
    expect(exported).toContain('xiaopaw_errors_total{component="runner",error_type="Error"} 1');
    expect(sender.sent[0]?.content).toBe("处理出错，请稍后重试。");
  });

  it("continues message handling when metrics hooks throw", async () => {
    const runner = new Runner({
      sessionManager,
      sender,
      metrics: {
        setRunnerWorkerActive() {
          throw new Error("metrics down");
        },
        setRunnerQueueSize() {
          throw new Error("metrics down");
        },
        recordError() {
          throw new Error("metrics down");
        },
      },
      agentFn: async () => "metrics-safe reply",
      idleTimeoutMs: 10,
    });

    await runner.dispatch(inbound("你好"));
    await waitFor(() => sender.updated.length === 1);

    expect(sender.updated[0]?.content).toBe("metrics-safe reply");
  });

  it("falls back to send when updateCard fails", async () => {
    sender.updateShouldFail = true;
    const runner = new Runner({
      sessionManager,
      sender,
      agentFn: async () => "fallback reply",
      idleTimeoutMs: 10,
    });

    await runner.dispatch(inbound("你好"));
    await waitFor(() => sender.sent.length === 1);

    expect(sender.sent[0]?.content).toBe("fallback reply");
  });

  it("processes the same routing key sequentially", async () => {
    const order: string[] = [];
    const agentFn: AgentFn = async (message) => {
      order.push(`start:${message}`);
      await sleep(message === "first" ? 20 : 0);
      order.push(`end:${message}`);
      return `reply:${message}`;
    };
    const runner = new Runner({ sessionManager, sender, agentFn, idleTimeoutMs: 10 });

    await runner.dispatch(inbound("first", { msgId: "om_1" }));
    await runner.dispatch(inbound("second", { msgId: "om_2" }));
    await waitFor(() => sender.updated.length === 2);

    expect(order).toEqual(["start:first", "end:first", "start:second", "end:second"]);
  });

  it("processes different routing keys concurrently", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started: string[] = [];
    const agentFn: AgentFn = async (message, _history, _sessionId, routingKey) => {
      started.push(`${routingKey}:${message}`);
      if (routingKey === "p2p:ou_a") {
        await firstBlocked;
      }
      return `reply:${message}`;
    };
    const runner = new Runner({ sessionManager, sender, agentFn, idleTimeoutMs: 10 });

    await runner.dispatch(
      inbound("first", {
        routingKey: "p2p:ou_a",
        msgId: "om_a",
        rootId: "om_a",
        senderId: "ou_a",
      }),
    );
    await waitFor(() => started.includes("p2p:ou_a:first"));

    await runner.dispatch(
      inbound("second", {
        routingKey: "p2p:ou_b",
        msgId: "om_b",
        rootId: "om_b",
        senderId: "ou_b",
      }),
    );
    await waitFor(() => sender.updated.some((item) => item.content === "reply:second"));

    expect(started).toEqual(["p2p:ou_a:first", "p2p:ou_b:second"]);
    expect(sender.updated.map((item) => item.content)).toEqual(["reply:second"]);

    releaseFirst();
    await waitFor(() => sender.updated.some((item) => item.content === "reply:first"));
  });

  it("accepts new messages after idle timeout cleanup", async () => {
    const seen: string[] = [];
    const runner = new Runner({
      sessionManager,
      sender,
      agentFn: async (message) => {
        seen.push(message);
        return `reply:${message}`;
      },
      idleTimeoutMs: 10,
    });

    await runner.dispatch(inbound("first", { msgId: "om_1" }));
    await waitFor(() => sender.updated.length === 1);
    await sleep(30);

    await runner.dispatch(inbound("second", { msgId: "om_2" }));
    await waitFor(() => sender.updated.length === 2);

    expect(seen).toEqual(["first", "second"]);
    expect(sender.updated.map((item) => item.content)).toEqual([
      "reply:first",
      "reply:second",
    ]);
  });

  it("downloads attachments and rewrites user message with sandbox path", async () => {
    const attachment: Attachment = {
      msgType: "file",
      fileKey: "file_001",
      fileName: "report.pdf",
    };
    const seenMessages: string[] = [];
    const downloader = {
      download: mock(async () => "/local/report.pdf"),
    };
    const runner = new Runner({
      sessionManager,
      sender,
      downloader,
      agentFn: async (message) => {
        seenMessages.push(message);
        return "done";
      },
      idleTimeoutMs: 10,
    });

    await runner.dispatch(inbound("请总结", { attachment }));
    await waitFor(() => sender.updated.length === 1);

    expect(downloader.download).toHaveBeenCalledTimes(1);
    expect(seenMessages[0]).toContain("/workspace/sessions/");
    expect(seenMessages[0]).toContain("uploads/report.pdf");
    expect(seenMessages[0]).toContain("用户备注：请总结");
  });

  it("continues with a failure hint when attachment download fails", async () => {
    const attachment: Attachment = {
      msgType: "file",
      fileKey: "file_001",
      fileName: "report.pdf",
    };
    const seenMessages: string[] = [];
    const downloader = {
      download: mock(async () => null),
    };
    const runner = new Runner({
      sessionManager,
      sender,
      downloader,
      agentFn: async (message) => {
        seenMessages.push(message);
        return "done";
      },
      idleTimeoutMs: 10,
    });

    await runner.dispatch(inbound("请总结", { attachment }));
    await waitFor(() => sender.updated.length === 1);

    expect(downloader.download).toHaveBeenCalledTimes(1);
    expect(seenMessages[0]).toBe("[附件下载失败] 请总结");
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1_000) {
      throw new Error("waitFor timeout");
    }
    await sleep(5);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
