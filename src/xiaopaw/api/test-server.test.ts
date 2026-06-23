import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { Runner, type AgentFn } from "../runner.ts";
import { XiaopawMetricsRegistry } from "../observability/metrics.ts";
import { createSessionManager, type SessionManager } from "../session/manager.ts";
import { CaptureSender } from "./capture-sender.ts";
import { handleTestRequest, type TestServerOptions } from "./test-server.ts";

function request(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: string | null } = {},
): Request {
  return new Request(`http://127.0.0.1${path}`, init as RequestInit);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("TestAPI server", () => {
  let dataDir = "";
  let workspaceDir = "";
  let sessionManager: SessionManager;
  let sender: CaptureSender;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "xiaopaw-test-api-data-"));
    workspaceDir = await mkdtemp(join(tmpdir(), "xiaopaw-test-api-workspace-"));
    sessionManager = await createSessionManager(dataDir);
    sender = new CaptureSender();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(workspaceDir, { recursive: true, force: true });
  });

  function makeOptions(agentFn: AgentFn): TestServerOptions {
    return {
      runner: new Runner({
        sessionManager,
        sender,
        agentFn,
        idleTimeoutMs: 10,
      }),
      sender,
      sessionManager,
      workspaceDir,
      replyTimeoutMs: 1_000,
    };
  }

  it("returns fake agent reply from POST /api/test/message", async () => {
    const options = makeOptions(async (message, history, sessionId) => {
      return [
        `收到消息：${message}`,
        `session=${sessionId}`,
        `history=${history.length}`,
      ].join("\n");
    });

    const response = await handleTestRequest(
      request("/api/test/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routing_key: "p2p:ou_test", content: "本地调试" }),
      }),
      options,
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body["msg_id"]).toMatch(/^test_[a-f0-9]{12}$/);
    expect(body["reply"]).toContain("收到消息：本地调试");
    expect(body["reply"]).toContain("session=s-");
    expect(body["reply"]).toContain("history=0");
    expect(body["session_id"]).toMatch(/^s-/);
    expect(typeof body["duration_ms"]).toBe("number");
    expect(body["skills_called"]).toEqual([]);
  });

  it("uses provided msg_id and sender_id when building inbound message", async () => {
    const seen: Array<{ sessionId: string; routingKey: string; rootId: string }> = [];
    const options = makeOptions(
      async (_message, _history, sessionId, routingKey, rootId) => {
        seen.push({ sessionId, routingKey, rootId });
        return "ok";
      },
    );

    const response = await handleTestRequest(
      request("/api/test/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing_key: "group:oc_test",
          content: "hello",
          msg_id: "test_fixed",
          sender_id: "ou_custom",
        }),
      }),
      options,
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body["msg_id"]).toBe("test_fixed");
    expect(seen).toEqual([
      {
        sessionId: body["session_id"] as string,
        routingKey: "group:oc_test",
        rootId: "test_fixed",
      },
    ]);
  });

  it("returns 400 for invalid JSON", async () => {
    const options = makeOptions(async () => "unused");

    const response = await handleTestRequest(
      request("/api/test/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid",
      }),
      options,
    );
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body["error"]).toBe("Invalid JSON body");
  });

  it("returns 422 for schema errors", async () => {
    const options = makeOptions(async () => "unused");

    const response = await handleTestRequest(
      request("/api/test/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "missing routing key" }),
      }),
      options,
    );
    const body = await readJson(response);

    expect(response.status).toBe(422);
    expect(Array.isArray(body["error"])).toBe(true);
  });

  it("returns 404 for unknown routes", async () => {
    const options = makeOptions(async () => "unused");

    const response = await handleTestRequest(
      request("/api/test/unknown", { method: "GET" }),
      options,
    );
    const body = await readJson(response);

    expect(response.status).toBe(404);
    expect(body["error"]).toBe("Not Found");
  });

  it("records HTTP metrics without changing responses", async () => {
    const metrics = new XiaopawMetricsRegistry();
    const options = {
      ...makeOptions(async () => "ok"),
      metrics,
    };

    const response = await handleTestRequest(
      request("/api/test/unknown", { method: "GET" }),
      options,
    );

    expect(response.status).toBe(404);
    expect(metrics.exportMetrics()).toContain(
      'xiaopaw_http_requests_total{method="GET",path="/api/test/unknown",status_code="404"} 1',
    );
  });

  it("clears sessions with DELETE /api/test/sessions", async () => {
    const options = makeOptions(async (message) => `reply:${message}`);

    await handleTestRequest(
      request("/api/test/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routing_key: "p2p:ou_test", content: "before" }),
      }),
      options,
    );
    const before = await sessionManager.getOrCreate("p2p:ou_test");
    expect((await sessionManager.loadHistory(before.id)).length).toBe(2);

    const response = await handleTestRequest(
      request("/api/test/sessions", { method: "DELETE" }),
      options,
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body["status"]).toBe("ok");

    const after = await sessionManager.getOrCreate("p2p:ou_test");
    expect(after.id).not.toBe(before.id);
    expect(await sessionManager.loadHistory(after.id)).toEqual([]);
  });

  it("copies attachment.file_path into workspace uploads", async () => {
    const sourcePath = join(dataDir, "source.txt");
    await writeFile(sourcePath, "hello file");
    const seenMessages: string[] = [];
    const options = makeOptions(async (message) => {
      seenMessages.push(message);
      return "done";
    });

    const response = await handleTestRequest(
      request("/api/test/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing_key: "p2p:ou_test",
          content: "请处理",
          attachment: {
            file_path: sourcePath,
            file_name: "renamed.txt",
          },
        }),
      }),
      options,
    );
    const body = await readJson(response);
    const sessionId = body["session_id"] as string;

    expect(response.status).toBe(200);
    expect(seenMessages[0]).toContain(
      `/workspace/sessions/${sessionId}/uploads/renamed.txt`,
    );
    expect(seenMessages[0]).toContain("（用户备注：请处理）");
    expect(
      existsSync(join(workspaceDir, "sessions", sessionId, "uploads", "renamed.txt")),
    ).toBe(true);
  });

  it("accepts attachment.filePath alias", async () => {
    const sourcePath = join(dataDir, "alias.txt");
    await writeFile(sourcePath, "hello alias");
    const seenMessages: string[] = [];
    const options = makeOptions(async (message) => {
      seenMessages.push(message);
      return "done";
    });

    const response = await handleTestRequest(
      request("/api/test/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing_key: "p2p:ou_test",
          attachment: {
            filePath: sourcePath,
          },
        }),
      }),
      options,
    );
    const body = await readJson(response);
    const sessionId = body["session_id"] as string;

    expect(response.status).toBe(200);
    expect(seenMessages[0]).toContain(
      `/workspace/sessions/${sessionId}/uploads/alias.txt`,
    );
    expect(
      existsSync(join(workspaceDir, "sessions", sessionId, "uploads", "alias.txt")),
    ).toBe(true);
  });

  it("keeps the main chain alive when attachment file is missing", async () => {
    const seenMessages: string[] = [];
    const options = makeOptions(async (message) => {
      seenMessages.push(message);
      return `agent saw: ${message}`;
    });
    const missingPath = join(dataDir, "missing.txt");

    const response = await handleTestRequest(
      request("/api/test/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing_key: "p2p:ou_test",
          content: "请处理",
          attachment: {
            file_path: missingPath,
          },
        }),
      }),
      options,
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(seenMessages[0]).toBe(`（附件文件不存在：${missingPath}）`);
    expect(body["reply"]).toBe(`agent saw: （附件文件不存在：${missingPath}）`);
  });
});
