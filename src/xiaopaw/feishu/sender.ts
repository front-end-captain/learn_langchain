import type { SenderProtocol } from "../models.ts";
import * as Lark from "@larksuiteoapi/node-sdk";

export interface FeishuApiResponse<TData = unknown> {
  code?: number | undefined;
  msg?: string | undefined;
  data?: TData;
}

export interface FeishuSenderOptions {
  client: Lark.Client;
  maxRetries?: number;
  retryBackoffMs?: readonly number[];
  sleepFn?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildCard(text: string): string {
  return JSON.stringify({
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: "div",
        text: {
          content: text,
          tag: "lark_md",
        },
      },
    ],
  });
}

export function assertFeishuOk(
  response: FeishuApiResponse,
  action: string,
): void {
  if (typeof response.code === "number" && response.code !== 0) {
    throw new Error(
      `${action} failed: ${response.code}, ${response.msg ?? ""}`,
    );
  }
}

function parseRoutingKey(
  routingKey: string,
):
  | { kind: "p2p"; receiveId: string }
  | { kind: "group"; receiveId: string }
  | { kind: "thread" } {
  if (routingKey.startsWith("p2p:")) {
    return { kind: "p2p", receiveId: routingKey.slice("p2p:".length) };
  }
  if (routingKey.startsWith("group:")) {
    return { kind: "group", receiveId: routingKey.slice("group:".length) };
  }
  if (routingKey.startsWith("thread:")) {
    return { kind: "thread" };
  }
  throw new Error(`Unknown routing_key: ${routingKey}`);
}

export class FeishuSender implements SenderProtocol {
  private readonly client: Lark.Client;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: readonly number[];
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options: FeishuSenderOptions) {
    this.client = options.client;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBackoffMs = options.retryBackoffMs ?? [1000, 2000, 4000];
    this.sleepFn = options.sleepFn ?? defaultSleep;
  }

  async send(
    routingKey: string,
    content: string,
    rootId: string,
  ): Promise<void> {
    await this.sendWithRetry(
      routingKey,
      "interactive",
      buildCard(content),
      rootId,
      "send",
    );
  }

  async sendText(
    routingKey: string,
    content: string,
    rootId: string,
  ): Promise<void> {
    await this.sendWithRetry(
      routingKey,
      "text",
      JSON.stringify({ text: content }),
      rootId,
      "sendText",
    );
  }

  async sendThinking(
    routingKey: string,
    rootId: string,
  ): Promise<string | null> {
    try {
      const response = await this.sendRaw(
        routingKey,
        "interactive",
        buildCard("⏳ 思考中，请稍候..."),
        rootId,
      );
      assertFeishuOk(response, "sendThinking");
      return response.data?.message_id ?? null;
    } catch (error) {
      console.warn("sendThinking failed:", error);
      return null;
    }
  }

  async updateCard(cardMsgId: string, content: string): Promise<void> {
    const response = await this.client.im.v1.message.patch({
      path: {
        message_id: cardMsgId,
      },
      data: {
        content: buildCard(content),
      },
    });
    assertFeishuOk(response, "updateCard");
  }

  private async sendWithRetry(
    routingKey: string,
    msgType: "interactive" | "text",
    content: string,
    uuid: string,
    action: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      try {
        const response = await this.sendRaw(routingKey, msgType, content, uuid);
        assertFeishuOk(response, action);
        return;
      } catch (error) {
        console.warn(
          `${action} failed to ${routingKey} (attempt ${attempt + 1}/${this.maxRetries}):`,
          error,
        );
        if (attempt + 1 >= this.maxRetries) {
          return;
        }
        const delay =
          this.retryBackoffMs[
            Math.min(attempt, this.retryBackoffMs.length - 1)
          ] ?? 0;
        await this.sleepFn(delay);
      }
    }
  }

  private async sendRaw(
    routingKey: string,
    msgType: "interactive" | "text",
    content: string,
    uuid: string,
  ) {
    const target = parseRoutingKey(routingKey);
    if (target.kind === "p2p") {
      return await this.client.im.v1.message.create({
        params: {
          receive_id_type: "open_id",
        },
        data: {
          receive_id: target.receiveId,
          msg_type: msgType,
          content,
          uuid,
        },
      });
    }

    if (target.kind === "group") {
      return await this.client.im.v1.message.create({
        params: {
          receive_id_type: "chat_id",
        },
        data: {
          receive_id: target.receiveId,
          msg_type: msgType,
          content,
          uuid,
        },
      });
    }

    return await this.client.im.v1.message.reply({
      path: {
        message_id: uuid,
      },
      data: {
        msg_type: msgType,
        content,
        reply_in_thread: true,
        uuid,
      },
    });
  }
}
