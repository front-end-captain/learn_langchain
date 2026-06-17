export interface Attachment {
  msgType: "image" | "file";
  fileKey: string;
  fileName: string;
}

export interface InboundMessage {
  routingKey: string;
  content: string;
  msgId: string;
  rootId: string;
  senderId: string;
  ts: number;
  isCron?: boolean;
  attachment?: Attachment | null;
}

export interface SenderProtocol {
  send(routingKey: string, content: string, rootId: string): Promise<void>;
  sendText(routingKey: string, content: string, rootId: string): Promise<void>;
  sendThinking(routingKey: string, rootId: string): Promise<string | null>;
  updateCard(cardMsgId: string, content: string): Promise<void>;
}
