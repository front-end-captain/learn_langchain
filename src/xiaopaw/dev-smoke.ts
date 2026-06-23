import * as Lark from "@larksuiteoapi/node-sdk";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { InboundMessage } from "./models.ts";
import { CaptureSender } from "./api/capture-sender.ts";
import { FeishuDownloader, FeishuListener, FeishuSender } from "./feishu/index.ts";
import { Runner } from "./runner.ts";
import { createSessionManager } from "./session/manager.ts";

const useFeishu = process.argv.includes("--feishu");
const appId = process.env["LARK_APP_ID"] ?? "";
const appSecret = process.env["LARK_APP_SECRET"] ?? "";

const dataDir = await mkdtemp(join(tmpdir(), "xiaopaw-smoke-"));
const sessionManager = await createSessionManager(dataDir);

if (useFeishu) {
  if (!appId || !appSecret) {
    throw new Error(
      "使用 --feishu 时必须设置 LARK_APP_ID / LARK_APP_SECRET",
    );
  }

  const client = new Lark.Client({
    appId,
    appSecret,
    loggerLevel: Lark.LoggerLevel.info,
  });
  const sender = new FeishuSender({ client });
  const downloader = new FeishuDownloader({ client, dataDir });
  const runner = new Runner({
    sessionManager,
    sender,
    downloader,
    agentFn: async (userMessage, history, sessionId) => {
      return [
        "收到消息：",
        userMessage,
        "",
        `当前 sessionId: ${sessionId}`,
        `历史条数: ${history.length}`,
        "",
        "这是 TypeScript dev-smoke 的 fake agent 回复，暂未接入真实 LLM。",
      ].join("\n");
    },
    idleTimeoutMs: 60_000,
  });

  const listener = new FeishuListener({
    appId,
    appSecret,
    onMessage: async (inbound) => {
      console.log("收到 InboundMessage:", JSON.stringify(inbound, null, 2));
      await runner.dispatch(inbound);
    },
  });

  console.log("dataDir:", dataDir);
  console.log("Feishu dev smoke 已启动，等待飞书消息...");
  console.log("按 Ctrl+C 退出。当前回复由 fake agent 生成，不调用真实 LLM。");

  const shutdown = async () => {
    await runner.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  await listener.start();
} else {
  const sender = new CaptureSender();

  const runner = new Runner({
    sessionManager,
    sender,
    agentFn: async (userMessage, history, sessionId) => {
      return [
        "收到消息：",
        userMessage,
        "",
        `当前 sessionId: ${sessionId}`,
        `历史条数: ${history.length}`,
      ].join("\n");
    },
    idleTimeoutMs: 1_000,
  });

  const msgId = "test_msg_001";
  sender.register(msgId);

  const inbound: InboundMessage = {
    routingKey: "p2p:ou_test",
    content: "你好，小爪子",
    msgId,
    rootId: msgId,
    senderId: "ou_test",
    ts: Date.now(),
  };

  await runner.dispatch(inbound);

  const reply = await sender.waitForReply(msgId, 3_000);

  console.log("dataDir:", dataDir);
  console.log("reply:");
  console.log(reply);

  await runner.shutdown();
}
