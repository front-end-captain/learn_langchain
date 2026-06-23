import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createSessionManager, type SessionManager } from "./manager.ts";

describe("SessionManager", () => {
  let dataDir = "";
  let manager: SessionManager;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "xiaopaw-session-"));
    manager = await createSessionManager(dataDir);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("creates and reuses an active session for a routing key", async () => {
    const first = await manager.getOrCreate("p2p:ou_user");
    const second = await manager.getOrCreate("p2p:ou_user");

    expect(second.id).toBe(first.id);
    expect(first.verbose).toBe(false);
    expect(first.messageCount).toBe(0);

    const index = await Bun.file(join(dataDir, "sessions", "index.json")).json();
    expect(index["p2p:ou_user"].active_session_id).toBe(first.id);
    expect(index["p2p:ou_user"].sessions[0]).toMatchObject({
      id: first.id,
      created_at: first.createdAt,
      verbose: false,
      message_count: 0,
    });

    const metaLine = (
      await readFile(join(dataDir, "sessions", `${first.id}.jsonl`), "utf8")
    ).trim();
    expect(JSON.parse(metaLine)).toMatchObject({
      type: "meta",
      session_id: first.id,
      routing_key: "p2p:ou_user",
    });
  });

  it("creates a new active session", async () => {
    const first = await manager.getOrCreate("group:oc_group");
    const second = await manager.createNewSession("group:oc_group");

    expect(second.id).not.toBe(first.id);

    const active = await manager.getOrCreate("group:oc_group");
    expect(active.id).toBe(second.id);
  });

  it("updates verbose on the active session", async () => {
    await manager.getOrCreate("p2p:ou_user");
    await manager.updateVerbose("p2p:ou_user", true);

    const session = await manager.getOrCreate("p2p:ou_user");
    expect(session.verbose).toBe(true);
  });

  it("appends user and assistant messages and loads recent history", async () => {
    const session = await manager.getOrCreate("p2p:ou_user");

    await manager.append({
      sessionId: session.id,
      user: "hello",
      feishuMsgId: "om_001",
      assistant: "hi",
    });
    await manager.append({
      sessionId: session.id,
      user: "question",
      feishuMsgId: "om_002",
      assistant: "answer",
    });

    const history = await manager.loadHistory(session.id, 2);
    expect(history.map((item) => item.content)).toEqual(["question", "answer"]);
    expect(history[0]?.feishuMsgId).toBe("om_002");

    const jsonl = await readFile(
      join(dataDir, "sessions", `${session.id}.jsonl`),
      "utf8",
    );
    const records = jsonl
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records[1]).toMatchObject({
      type: "message",
      role: "user",
      content: "hello",
      feishu_msg_id: "om_001",
    });
    expect(records[2]).toMatchObject({
      type: "message",
      role: "assistant",
      content: "hi",
    });

    const updated = await manager.getOrCreate("p2p:ou_user");
    expect(updated.messageCount).toBe(4);
  });

  it("clears all session data", async () => {
    const session = await manager.getOrCreate("p2p:ou_user");
    await manager.append({
      sessionId: session.id,
      user: "hello",
      feishuMsgId: "om_001",
      assistant: "hi",
    });

    await manager.clearAll();

    const index = await Bun.file(join(dataDir, "sessions", "index.json")).json();
    expect(index).toEqual({});
    expect(await Bun.file(join(dataDir, "sessions", `${session.id}.jsonl`)).exists()).toBe(
      false,
    );
  });

  it("falls back to the last session when active_session_id is missing", async () => {
    await mkdir(join(dataDir, "sessions"), { recursive: true });
    await writeFile(
      join(dataDir, "sessions", "index.json"),
      JSON.stringify({
        "p2p:ou_user": {
          active_session_id: "s-missing",
          sessions: [
            {
              id: "s-old",
              created_at: "2026-01-01T00:00:00.000Z",
              verbose: false,
              message_count: 2,
            },
            {
              id: "s-last",
              created_at: "2026-01-02T00:00:00.000Z",
              verbose: true,
              message_count: 4,
            },
          ],
        },
      }),
    );

    const session = await manager.getOrCreate("p2p:ou_user");

    expect(session).toEqual({
      id: "s-last",
      createdAt: "2026-01-02T00:00:00.000Z",
      verbose: true,
      messageCount: 4,
    });
  });

  it("creates a new session when routing entry has no sessions", async () => {
    await mkdir(join(dataDir, "sessions"), { recursive: true });
    await writeFile(
      join(dataDir, "sessions", "index.json"),
      JSON.stringify({
        "p2p:ou_empty": {
          active_session_id: "",
          sessions: [],
        },
      }),
    );

    const session = await manager.getOrCreate("p2p:ou_empty");

    expect(session.id).toStartWith("s-");
    const index = await Bun.file(join(dataDir, "sessions", "index.json")).json();
    expect(index["p2p:ou_empty"].active_session_id).toBe(session.id);
    expect(index["p2p:ou_empty"].sessions).toHaveLength(1);
  });
});
