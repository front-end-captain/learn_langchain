export type RoutingKey =
  | `p2p:${string}`
  | `group:${string}`
  | `thread:${string}:${string}`;

export interface ResolveRoutingKeyInput {
  chatType: string;
  senderId: string;
  chatId: string;
  threadId?: string | null;
}

export function resolveRoutingKey({
  chatType,
  senderId,
  chatId,
  threadId,
}: ResolveRoutingKeyInput): RoutingKey {
  if (chatType === "p2p") {
    return `p2p:${senderId}`;
  }

  if (threadId) {
    return `thread:${chatId}:${threadId}`;
  }

  return `group:${chatId}`;
}
