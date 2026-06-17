import { describe, expect, it, mock } from "bun:test";
import * as Lark from "@larksuiteoapi/node-sdk";

import { buildCard, FeishuSender, type FeishuApiResponse } from "./sender.ts";

function createMockClient(input?: {
  create?: (
    payload: unknown,
  ) => Promise<FeishuApiResponse<{ message_id?: string }>>;
  reply?: (
    payload: unknown,
  ) => Promise<FeishuApiResponse<{ message_id?: string }>>;
  patch?: (payload: unknown) => Promise<FeishuApiResponse<undefined>>;
}): Lark.Client & {
  calls: {
    create: unknown[];
    reply: unknown[];
    patch: unknown[];
  };
} {
  const calls = {
    create: [] as unknown[],
    reply: [] as unknown[],
    patch: [] as unknown[],
  };

  return {
    calls,
    im: {
      v1: {
        // @ts-ignore 仅mock需要到的方法
        message: {
          create: async (payload: unknown) => {
            calls.create.push(payload);
            return input?.create
              ? await input.create(payload)
              : { code: 0, data: { message_id: "om_card" } };
          },
          reply: async (payload: unknown) => {
            calls.reply.push(payload);
            return input?.reply
              ? await input.reply(payload)
              : { code: 0, data: { message_id: "om_reply" } };
          },
          patch: async (payload: unknown) => {
            calls.patch.push(payload);
            return input?.patch
              ? await input.patch(payload)
              : { code: 0, data: undefined };
          },
        },
      },
    },
  };
}

describe("buildCard", () => {
  it("builds lark_md interactive card json", () => {
    const card = JSON.parse(buildCard("**hello**"));
    expect(card.config.wide_screen_mode).toBe(true);
    expect(card.elements[0].tag).toBe("div");
    expect(card.elements[0].text).toEqual({
      content: "**hello**",
      tag: "lark_md",
    });
  });
});

describe("FeishuSender.send", () => {
  it("sends p2p messages with open_id receive type", async () => {
    const client = createMockClient();
    const sender = new FeishuSender({ client, retryBackoffMs: [0] });

    await sender.send("p2p:ou_user", "hello", "om_root");

    expect(client.calls.create).toHaveLength(1);
    expect(client.calls.create[0]).toMatchObject({
      params: { receive_id_type: "open_id" },
      data: {
        receive_id: "ou_user",
        msg_type: "interactive",
        uuid: "om_root",
      },
    });
  });

  it("sends group messages with chat_id receive type", async () => {
    const client = createMockClient();
    const sender = new FeishuSender({ client, retryBackoffMs: [0] });

    await sender.send("group:oc_group", "hello", "om_root");

    expect(client.calls.create).toHaveLength(1);
    expect(client.calls.create[0]).toMatchObject({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_group",
        msg_type: "interactive",
        uuid: "om_root",
      },
    });
  });

  it("replies in thread for thread routing keys", async () => {
    const client = createMockClient();
    const sender = new FeishuSender({ client, retryBackoffMs: [0] });

    await sender.send("thread:oc_group:omt_thread", "hello", "om_root");

    expect(client.calls.reply).toHaveLength(1);
    expect(client.calls.reply[0]).toMatchObject({
      path: { message_id: "om_root" },
      data: {
        msg_type: "interactive",
        reply_in_thread: true,
        uuid: "om_root",
      },
    });
  });

  it("does not throw after retries are exhausted", async () => {
    const client = createMockClient({
      create: async () => ({ code: 999, msg: "failed" }),
    });
    const sleepFn = mock(async (_ms: number) => undefined);
    const sender = new FeishuSender({
      client,
      maxRetries: 3,
      retryBackoffMs: [0, 0, 0],
      sleepFn,
    });

    await expect(
      sender.send("p2p:ou_user", "hello", "om_root"),
    ).resolves.toBeUndefined();
    expect(client.calls.create).toHaveLength(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });
});

describe("FeishuSender.sendText", () => {
  it("sends text json content", async () => {
    const client = createMockClient();
    const sender = new FeishuSender({ client, retryBackoffMs: [0] });

    await sender.sendText("p2p:ou_user", "slash reply", "om_root");

    expect(client.calls.create[0]).toMatchObject({
      data: {
        msg_type: "text",
        content: JSON.stringify({ text: "slash reply" }),
      },
    });
  });
});

describe("FeishuSender.sendThinking", () => {
  it("returns created message id", async () => {
    const client = createMockClient({
      create: async () => ({ code: 0, data: { message_id: "om_loading" } }),
    });
    const sender = new FeishuSender({ client, retryBackoffMs: [0] });

    await expect(sender.sendThinking("p2p:ou_user", "om_root")).resolves.toBe(
      "om_loading",
    );
  });

  it("returns null on sdk failure or api failure", async () => {
    const apiFail = createMockClient({
      create: async () => ({ code: 1, msg: "bad" }),
    });
    const sdkFail = createMockClient({
      create: async () => {
        throw new Error("network");
      },
    });

    await expect(
      new FeishuSender({ client: apiFail }).sendThinking(
        "p2p:ou_user",
        "om_root",
      ),
    ).resolves.toBeNull();
    await expect(
      new FeishuSender({ client: sdkFail }).sendThinking(
        "p2p:ou_user",
        "om_root",
      ),
    ).resolves.toBeNull();
  });
});

describe("FeishuSender.updateCard", () => {
  it("patches card content", async () => {
    const client = createMockClient();
    const sender = new FeishuSender({ client });

    await sender.updateCard("om_card", "final");

    expect(client.calls.patch).toHaveLength(1);
    expect(client.calls.patch[0]).toMatchObject({
      path: { message_id: "om_card" },
      data: { content: buildCard("final") },
    });
  });

  it("throws when patch api fails", async () => {
    const client = createMockClient({
      patch: async () => ({ code: 2, msg: "patch failed" }),
    });
    const sender = new FeishuSender({ client });

    await expect(sender.updateCard("om_card", "final")).rejects.toThrow(
      "updateCard failed",
    );
  });
});
