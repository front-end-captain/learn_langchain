import * as Lark from "@larksuiteoapi/node-sdk";

import type { Attachment, InboundMessage } from "../models.ts";
import { resolveRoutingKey } from "./session-key.ts";

export type OnMessageFn = (message: InboundMessage) => Promise<void>;
export type OnBotAddedFn = (chatId: string, groupName: string) => Promise<void>;

export interface FeishuListenerMetrics {
  recordFeishuEvent(eventType: string, chatType: string): void;
  recordInboundMessage(routingKey: string, hasAttachment: boolean): void;
}

export interface FeishuWsClientLike {
  start(input: { eventDispatcher: unknown }): Promise<void> | void;
}

export interface FeishuListenerOptions {
  appId: string;
  appSecret: string;
  onMessage: OnMessageFn;
  loggerLevel?: Lark.LoggerLevel;
  onBotAdded?: OnBotAddedFn;
  allowedChats?: string[] | null;
  metrics?: FeishuListenerMetrics;
  wsClientFactory?: (input: {
    appId: string;
    appSecret: string;
    loggerLevel: Lark.LoggerLevel;
  }) => FeishuWsClientLike;
}

interface FeishuReceiveMessageEvent {
  sender?: {
    sender_id?: {
      open_id?: string;
    };
  };
  message?: {
    message_id?: string;
    root_id?: string;
    create_time?: string | number;
    chat_id?: string;
    thread_id?: string | null;
    chat_type?: string;
    message_type?: string;
    content?: string;
  };
}

interface FeishuBotAddedEvent {
  chat_id?: string;
  name?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function isChatAllowed(input: {
  chatId: string;
  chatType: string;
  allowedChats: readonly string[] | null | undefined;
}): boolean {
  if (input.chatType === "p2p") {
    return true;
  }
  if (!input.allowedChats || input.allowedChats.length === 0) {
    return true;
  }
  return input.allowedChats.includes(input.chatId);
}

export function extractPostText(data: unknown): string {
  try {
    if (!isRecord(data)) {
      return "";
    }

    const nodeValue = isRecord(data["zh_cn"]) ? data["zh_cn"] : data;
    const title = getString(nodeValue["title"]);
    const rawContent = nodeValue["content"];
    if (!Array.isArray(rawContent)) {
      return "";
    }

    const paragraphTexts = rawContent.map((paragraph) => {
      if (!Array.isArray(paragraph)) {
        return "";
      }
      const words = paragraph
        .filter(
          (elem): elem is Record<string, unknown> =>
            isRecord(elem) && elem["tag"] === "text",
        )
        .map((elem) => getString(elem["text"]));
      return words.join(" ");
    });

    const body = paragraphTexts.join(" ");
    return title ? `${title}\n${body}`.trim() : body.trim();
  } catch {
    return "";
  }
}

export function extractContent(msgType: string, contentJson: string): string {
  if (!contentJson) {
    return "";
  }

  let data: unknown;
  try {
    data = JSON.parse(contentJson);
  } catch {
    return "";
  }

  if (msgType === "text") {
    return isRecord(data) ? getString(data["text"]) : "";
  }

  if (msgType === "post") {
    return extractPostText(data);
  }

  return "";
}

export function extractAttachment(
  msgType: string,
  contentJson: string,
): Attachment | null {
  if (msgType !== "image" && msgType !== "file") {
    return null;
  }
  if (!contentJson) {
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(contentJson);
  } catch {
    return null;
  }
  if (!isRecord(data)) {
    return null;
  }

  if (msgType === "image") {
    const imageKey = getString(data["image_key"]);
    if (!imageKey) {
      return null;
    }
    return {
      msgType: "image",
      fileKey: imageKey,
      fileName: `${imageKey}.jpg`,
    };
  }

  const fileKey = getString(data["file_key"]);
  if (!fileKey) {
    return null;
  }
  const fileName = getString(data["file_name"]) || fileKey;
  return {
    msgType: "file",
    fileKey,
    fileName,
  };
}

export function parseFeishuTimestamp(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeReceiveMessageEvent(
  data: FeishuReceiveMessageEvent,
): InboundMessage {
  const message = data.message ?? {};
  const senderOpenId = data.sender?.sender_id?.open_id ?? "";
  const chatType = message.chat_type ?? "";
  const chatId = message.chat_id ?? "";
  const threadId = message.thread_id ?? null;
  const msgType = message.message_type ?? "";
  const contentJson = message.content ?? "";
  const msgId = message.message_id ?? "";
  const routingKey = resolveRoutingKey({
    chatType,
    senderId: senderOpenId,
    chatId,
    threadId,
  });

  return {
    routingKey,
    content: extractContent(msgType, contentJson),
    msgId,
    rootId: message.root_id || msgId,
    senderId: senderOpenId,
    ts: parseFeishuTimestamp(message.create_time),
    attachment: extractAttachment(msgType, contentJson),
  };
}

function defaultWsClientFactory(input: {
  appId: string;
  appSecret: string;
  loggerLevel: Lark.LoggerLevel;
}): FeishuWsClientLike {
  return new Lark.WSClient({
    appId: input.appId,
    appSecret: input.appSecret,
    loggerLevel: input.loggerLevel,
  });
}

export class FeishuListener {
  private readonly wsClient: FeishuWsClientLike;
  private readonly eventDispatcher: unknown;
  private readonly onMessage: OnMessageFn;
  private readonly onBotAdded: OnBotAddedFn | undefined;
  private readonly allowedChats: readonly string[] | null | undefined;
  private readonly metrics: FeishuListenerMetrics | undefined;

  constructor(options: FeishuListenerOptions) {
    this.onMessage = options.onMessage;
    this.onBotAdded = options.onBotAdded;
    this.allowedChats = options.allowedChats;
    this.metrics = options.metrics;
    const loggerLevel = options.loggerLevel ?? Lark.LoggerLevel.info;
    this.wsClient = (options.wsClientFactory ?? defaultWsClientFactory)({
      appId: options.appId,
      appSecret: options.appSecret,
      loggerLevel,
    });

    const dispatcher = new Lark.EventDispatcher({
      loggerLevel,
    });
    this.eventDispatcher = dispatcher.register({
      "im.message.receive_v1": async (data: unknown) => {
        await this.handleMessageEvent(data as FeishuReceiveMessageEvent);
      },
      "im.chat.member.bot.added_v1": async (data: unknown) => {
        await this.handleBotAddedEvent(data as FeishuBotAddedEvent);
      },
    });
  }

  async start(): Promise<void> {
    await this.wsClient.start({ eventDispatcher: this.eventDispatcher });
  }

  private async handleMessageEvent(
    data: FeishuReceiveMessageEvent,
  ): Promise<void> {
    const message = data.message ?? {};
    const chatType = message.chat_type ?? "";
    const chatId = message.chat_id ?? "";
    this.metrics?.recordFeishuEvent("im.message.receive_v1", chatType);

    if (!isChatAllowed({ chatId, chatType, allowedChats: this.allowedChats })) {
      return;
    }

    const inbound = normalizeReceiveMessageEvent(data);
    this.metrics?.recordInboundMessage(
      inbound.routingKey,
      inbound.attachment !== null,
    );
    await this.onMessage(inbound);
  }

  private async handleBotAddedEvent(data: FeishuBotAddedEvent): Promise<void> {
    const chatId = data.chat_id ?? "";
    this.metrics?.recordFeishuEvent("im.chat.member.bot.added_v1", "group");
    if (
      !isChatAllowed({
        chatId,
        chatType: "group",
        allowedChats: this.allowedChats,
      })
    ) {
      return;
    }
    if (this.onBotAdded) {
      await this.onBotAdded(chatId, data.name ?? "");
    }
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runForever(
  listener: Pick<FeishuListener, "start">,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<never> {
  while (true) {
    try {
      await listener.start();
    } catch (error) {
      console.warn("FeishuListener stopped with error, retrying:", error);
      await sleepFn(5000);
    }
  }
}
