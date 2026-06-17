import { describe, expect, it, mock } from "bun:test";

import {
  extractAttachment,
  extractContent,
  extractPostText,
  FeishuListener,
  isChatAllowed,
  normalizeReceiveMessageEvent,
  parseFeishuTimestamp,
} from "./listener.ts";

describe("isChatAllowed", () => {
  it("always allows p2p", () => {
    expect(
      isChatAllowed({
        chatId: "oc_blocked",
        chatType: "p2p",
        allowedChats: ["oc_allowed"],
      }),
    ).toBe(true);
  });

  it("allows all groups when allow list is empty", () => {
    expect(
      isChatAllowed({ chatId: "oc_any", chatType: "group", allowedChats: [] }),
    ).toBe(true);
  });

  it("checks group chat ids against allow list", () => {
    expect(
      isChatAllowed({
        chatId: "oc_allowed",
        chatType: "group",
        allowedChats: ["oc_allowed"],
      }),
    ).toBe(true);
    expect(
      isChatAllowed({
        chatId: "oc_blocked",
        chatType: "group",
        allowedChats: ["oc_allowed"],
      }),
    ).toBe(false);
  });
});

describe("content extraction", () => {
  it("extracts text messages", () => {
    expect(extractContent("text", JSON.stringify({ text: "hello" }))).toBe("hello");
  });

  it("returns empty string for invalid json", () => {
    expect(extractContent("text", "not-json{")).toBe("");
  });

  it("extracts post text with title and paragraphs", () => {
    const post = {
      zh_cn: {
        title: "标题",
        content: [
          [
            { tag: "text", text: "第一段" },
            { tag: "a", text: "忽略链接" },
          ],
          [{ tag: "text", text: "第二段" }],
        ],
      },
    };
    expect(extractPostText(post)).toBe("标题\n第一段 第二段");
    expect(extractContent("post", JSON.stringify(post))).toBe("标题\n第一段 第二段");
  });

  it("returns empty string for malformed post content", () => {
    expect(extractPostText({ zh_cn: { title: "标题" } })).toBe("");
    expect(extractPostText(null)).toBe("");
  });
});

describe("attachment extraction", () => {
  it("extracts image attachment", () => {
    expect(
      extractAttachment("image", JSON.stringify({ image_key: "img_001" })),
    ).toEqual({
      msgType: "image",
      fileKey: "img_001",
      fileName: "img_001.jpg",
    });
  });

  it("extracts file attachment", () => {
    expect(
      extractAttachment(
        "file",
        JSON.stringify({ file_key: "file_001", file_name: "report.pdf" }),
      ),
    ).toEqual({
      msgType: "file",
      fileKey: "file_001",
      fileName: "report.pdf",
    });
  });

  it("uses file_key as fallback file name", () => {
    expect(
      extractAttachment("file", JSON.stringify({ file_key: "file_001" })),
    ).toEqual({
      msgType: "file",
      fileKey: "file_001",
      fileName: "file_001",
    });
  });

  it("returns null for unsupported or invalid attachments", () => {
    expect(extractAttachment("text", JSON.stringify({ text: "hi" }))).toBeNull();
    expect(extractAttachment("image", "not-json{")).toBeNull();
    expect(extractAttachment("image", JSON.stringify({}))).toBeNull();
    expect(extractAttachment("file", JSON.stringify({}))).toBeNull();
  });
});

describe("normalizeReceiveMessageEvent", () => {
  it("builds inbound messages and falls back rootId to msgId", () => {
    const inbound = normalizeReceiveMessageEvent({
      sender: { sender_id: { open_id: "ou_user" } },
      message: {
        message_id: "om_001",
        create_time: "12345",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    });

    expect(inbound).toEqual({
      routingKey: "p2p:ou_user",
      content: "hello",
      msgId: "om_001",
      rootId: "om_001",
      senderId: "ou_user",
      ts: 12345,
      attachment: null,
    });
  });

  it("builds thread routing and attachment metadata", () => {
    const inbound = normalizeReceiveMessageEvent({
      sender: { sender_id: { open_id: "ou_user" } },
      message: {
        message_id: "om_002",
        root_id: "om_root",
        create_time: "bad",
        chat_id: "oc_group",
        thread_id: "omt_thread",
        chat_type: "group",
        message_type: "image",
        content: JSON.stringify({ image_key: "img_001" }),
      },
    });

    expect(inbound.routingKey).toBe("thread:oc_group:omt_thread");
    expect(inbound.rootId).toBe("om_root");
    expect(inbound.ts).toBe(0);
    expect(inbound.attachment).toEqual({
      msgType: "image",
      fileKey: "img_001",
      fileName: "img_001.jpg",
    });
  });
});

describe("parseFeishuTimestamp", () => {
  it("parses integer timestamps safely", () => {
    expect(parseFeishuTimestamp("1000")).toBe(1000);
    expect(parseFeishuTimestamp("bad")).toBe(0);
    expect(parseFeishuTimestamp(undefined)).toBe(0);
  });
});

describe("FeishuListener", () => {
  it("starts ws client with event dispatcher", async () => {
    const start = mock(async (_input: { eventDispatcher: unknown }) => undefined);
    const listener = new FeishuListener({
      appId: "app",
      appSecret: "secret",
      onMessage: async () => undefined,
      wsClientFactory: () => ({ start }),
    });

    await listener.start();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("keeps listener constructible with bot callback and allow list", () => {
    const listener = new FeishuListener({
      appId: "app",
      appSecret: "secret",
      allowedChats: ["oc_allowed"],
      onMessage: async () => undefined,
      onBotAdded: async () => undefined,
      wsClientFactory: () => ({ start: async () => undefined }),
    });

    expect(listener).toBeInstanceOf(FeishuListener);
  });
});
