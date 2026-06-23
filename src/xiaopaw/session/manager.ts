import { mkdir, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  MessageEntry,
  RawSessionEntry,
  RawSessionIndex,
  SessionEntry,
} from "./models.ts";

class AsyncLock {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = previous.then(() => current, () => current);

    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class SessionManager {
  private readonly sessionsDir: string;
  private readonly indexPath: string;
  private readonly indexLock = new AsyncLock();
  private readonly jsonlLocks = new Map<string, AsyncLock>();

  constructor(dataDir: string) {
    this.sessionsDir = join(dataDir, "sessions");
    this.indexPath = join(this.sessionsDir, "index.json");
  }

  async init(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    await rm(`${this.indexPath}.tmp`, { force: true });
  }

  async getOrCreate(routingKey: string): Promise<SessionEntry> {
    return this.indexLock.runExclusive(async () => {
      const index = await this.readIndex();
      const routing = index[routingKey];
      if (!routing) {
        const entry = makeNewSession();
        index[routingKey] = {
          active_session_id: entry.id,
          sessions: [sessionToRaw(entry)],
        };
        await this.writeIndex(index);
        await this.writeJsonlMeta(entry.id, routingKey);
        return entry;
      }

      const active = routing.sessions.find(
        (session) => session.id === routing.active_session_id,
      );
      if (active) {
        return rawToSession(active);
      }

      const fallback = routing.sessions.at(-1);
      if (fallback) {
        return rawToSession(fallback);
      }

      const entry = makeNewSession();
      routing.active_session_id = entry.id;
      routing.sessions.push(sessionToRaw(entry));
      await this.writeIndex(index);
      await this.writeJsonlMeta(entry.id, routingKey);
      return entry;
    });
  }

  async createNewSession(routingKey: string): Promise<SessionEntry> {
    const entry = await this.indexLock.runExclusive(async () => {
      const index = await this.readIndex();
      const routing = index[routingKey] ?? {
        active_session_id: "",
        sessions: [],
      };
      const newEntry = makeNewSession();
      routing.sessions.push(sessionToRaw(newEntry));
      routing.active_session_id = newEntry.id;
      index[routingKey] = routing;
      await this.writeIndex(index);
      return newEntry;
    });

    await this.writeJsonlMeta(entry.id, routingKey);
    return entry;
  }

  async updateVerbose(routingKey: string, verbose: boolean): Promise<void> {
    await this.indexLock.runExclusive(async () => {
      const index = await this.readIndex();
      const routing = index[routingKey];
      if (!routing) {
        return;
      }

      const active = routing.sessions.find(
        (session) => session.id === routing.active_session_id,
      );
      if (active) {
        active.verbose = verbose;
        await this.writeIndex(index);
      }
    });
  }

  async loadHistory(
    sessionId: string,
    maxTurns: number = 20,
  ): Promise<MessageEntry[]> {
    const jsonlPath = this.jsonlPath(sessionId);
    const file = Bun.file(jsonlPath);
    if (!(await file.exists())) {
      return [];
    }

    const content = await file.text();
    const messages: MessageEntry[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const record = JSON.parse(line) as Record<string, unknown>;
      if (record["type"] !== "message") {
        continue;
      }
      const role = record["role"];
      if (role !== "user" && role !== "assistant") {
        continue;
      }
      messages.push({
        role,
        content: typeof record["content"] === "string" ? record["content"] : "",
        ts: typeof record["ts"] === "number" ? record["ts"] : 0,
        feishuMsgId:
          typeof record["feishu_msg_id"] === "string"
            ? record["feishu_msg_id"]
            : null,
      });
    }

    return messages.length > maxTurns ? messages.slice(-maxTurns) : messages;
  }

  async append(input: {
    sessionId: string;
    user: string;
    feishuMsgId: string;
    assistant: string;
  }): Promise<void> {
    const ts = Date.now();
    const entries = [
      {
        type: "message",
        role: "user",
        content: input.user,
        ts,
        feishu_msg_id: input.feishuMsgId,
      },
      {
        type: "message",
        role: "assistant",
        content: input.assistant,
        ts,
      },
    ];

    await this.lockForSession(input.sessionId).runExclusive(async () => {
      const handle = await open(this.jsonlPath(input.sessionId), "a");
      try {
        for (const entry of entries) {
          await handle.write(`${JSON.stringify(entry)}\n`);
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
    });

    await this.indexLock.runExclusive(async () => {
      const index = await this.readIndex();
      for (const routing of Object.values(index)) {
        const session = routing.sessions.find(
          (item) => item.id === input.sessionId,
        );
        if (session) {
          session.message_count = (session.message_count ?? 0) + 2;
          await this.writeIndex(index);
          return;
        }
      }
    });
  }

  async getSessionInfo(routingKey: string): Promise<SessionEntry> {
    return this.getOrCreate(routingKey);
  }

  async clearAll(): Promise<void> {
    await this.indexLock.runExclusive(async () => {
      await mkdir(this.sessionsDir, { recursive: true });
      const files = await readdir(this.sessionsDir);
      await Promise.all(
        files
          .filter((file) => file.startsWith("s-") && file.endsWith(".jsonl"))
          .map((file) => rm(join(this.sessionsDir, file), { force: true })),
      );
      await this.writeIndex({});
      this.jsonlLocks.clear();
    });
  }

  private async readIndex(): Promise<RawSessionIndex> {
    const file = Bun.file(this.indexPath);
    if (!(await file.exists())) {
      return {};
    }
    const text = await file.text();
    if (!text.trim()) {
      return {};
    }
    return JSON.parse(text) as RawSessionIndex;
  }

  private async writeIndex(index: RawSessionIndex): Promise<void> {
    await mkdir(dirname(this.indexPath), { recursive: true });
    const tmpPath = `${this.indexPath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(index, null, 2));
    await rename(tmpPath, this.indexPath);
  }

  private async writeJsonlMeta(
    sessionId: string,
    routingKey: string,
  ): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    const meta = {
      type: "meta",
      session_id: sessionId,
      routing_key: routingKey,
      created_at: new Date().toISOString(),
    };
    const handle = await open(this.jsonlPath(sessionId), "w");
    try {
      await handle.write(`${JSON.stringify(meta)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private jsonlPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.jsonl`);
  }

  private lockForSession(sessionId: string): AsyncLock {
    const existing = this.jsonlLocks.get(sessionId);
    if (existing) {
      return existing;
    }
    const lock = new AsyncLock();
    this.jsonlLocks.set(sessionId, lock);
    return lock;
  }
}

function makeNewSession(): SessionEntry {
  return {
    id: `s-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
    createdAt: new Date().toISOString(),
    verbose: false,
    messageCount: 0,
  };
}

function sessionToRaw(entry: SessionEntry): RawSessionEntry {
  return {
    id: entry.id,
    created_at: entry.createdAt,
    verbose: entry.verbose,
    message_count: entry.messageCount,
  };
}

function rawToSession(raw: RawSessionEntry): SessionEntry {
  return {
    id: raw.id,
    createdAt: raw.created_at,
    verbose: raw.verbose ?? false,
    messageCount: raw.message_count ?? 0,
  };
}

export async function createSessionManager(
  dataDir: string,
): Promise<SessionManager> {
  const manager = new SessionManager(dataDir);
  await manager.init();
  return manager;
}
