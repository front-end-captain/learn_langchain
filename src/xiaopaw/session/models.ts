export interface SessionEntry {
  id: string;
  createdAt: string;
  verbose: boolean;
  messageCount: number;
}

export interface RoutingEntry {
  activeSessionId: string;
  sessions: SessionEntry[];
}

export interface MessageEntry {
  role: "user" | "assistant";
  content: string;
  ts: number;
  feishuMsgId?: string | null;
}

export interface RawSessionEntry {
  id: string;
  created_at: string;
  verbose?: boolean;
  message_count?: number;
}

export interface RawRoutingEntry {
  active_session_id: string;
  sessions: RawSessionEntry[];
}

export type RawSessionIndex = Record<string, RawRoutingEntry>;
