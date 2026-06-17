import { describe, expect, it } from "bun:test";

import { resolveRoutingKey } from "./session-key.ts";

describe("resolveRoutingKey", () => {
  it("routes p2p chats by sender open_id", () => {
    expect(
      resolveRoutingKey({
        chatType: "p2p",
        senderId: "ou_user",
        chatId: "",
        threadId: null,
      }),
    ).toBe("p2p:ou_user");
  });

  it("routes normal group chats by chat_id", () => {
    expect(
      resolveRoutingKey({
        chatType: "group",
        senderId: "ou_user",
        chatId: "oc_group",
        threadId: null,
      }),
    ).toBe("group:oc_group");
  });

  it("routes topic messages by chat_id and thread_id", () => {
    expect(
      resolveRoutingKey({
        chatType: "group",
        senderId: "ou_user",
        chatId: "oc_group",
        threadId: "omt_thread",
      }),
    ).toBe("thread:oc_group:omt_thread");
  });
});
