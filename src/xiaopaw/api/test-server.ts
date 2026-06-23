import { copyFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

import type { InboundMessage } from "../models.ts";
import { Runner } from "../runner.ts";
import { SessionManager } from "../session/manager.ts";
import { CaptureSender } from "./capture-sender.ts";
import { testRequestSchema, type TestResponse } from "./schemas.ts";

const DEFAULT_TIMEOUT_MS = 300_000;

export interface TestServerOptions {
  runner: Runner;
  sender: CaptureSender;
  sessionManager?: SessionManager;
  workspaceDir?: string;
  replyTimeoutMs?: number;
  metrics?: {
    recordHttpRequest(input: {
      path: string;
      method: string;
      statusCode: number;
      durationMs?: number;
    }): void;
    recordError(component: string, errorType: string): void;
  };
}

export interface StartTestServerOptions extends TestServerOptions {
  host?: string;
  port: number;
}

export function createTestServer(options: TestServerOptions): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: 0,
    fetch: (request) => handleTestRequest(request, options),
  });
}

export function startTestServer(
  options: StartTestServerOptions,
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: options.host ?? "127.0.0.1",
    port: options.port,
    fetch: (request) => handleTestRequest(request, options),
  });
}

export async function handleTestRequest(
  request: Request,
  options: TestServerOptions,
): Promise<Response> {
  const started = performance.now();
  const url = new URL(request.url);
  let response: Response;
  try {
    if (request.method === "POST" && url.pathname === "/api/test/message") {
      response = await handleMessage(request, options);
    } else if (request.method === "DELETE" && url.pathname === "/api/test/sessions") {
      response = await handleDeleteSessions(options);
    } else {
      response = jsonResponse({ error: "Not Found" }, 404);
    }
  } catch (error) {
    safeRecordError(options, "test_api", error);
    throw error;
  }
  safeRecordHttp(options, {
    path: url.pathname,
    method: request.method,
    statusCode: response.status,
    durationMs: performance.now() - started,
  });
  return response;
}

async function handleMessage(
  request: Request,
  options: TestServerOptions,
): Promise<Response> {
  const started = performance.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const parsed = testRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: parsed.error.issues }, 422);
  }

  const testRequest = parsed.data;
  const msgId = testRequest.msg_id ?? makeTestMessageId();
  let content = testRequest.content;

  if (testRequest.attachment && options.sessionManager) {
    const session = await options.sessionManager.getOrCreate(testRequest.routing_key);
    const copyInput: {
      attachmentPath: string;
      fileName?: string;
      sessionId: string;
      workspaceDir?: string;
      originalText: string;
    } = {
      attachmentPath: testRequest.attachment.file_path,
      sessionId: session.id,
      originalText: content,
    };
    if (testRequest.attachment.file_name) {
      copyInput.fileName = testRequest.attachment.file_name;
    }
    if (options.workspaceDir) {
      copyInput.workspaceDir = options.workspaceDir;
    }
    content = await copyAttachment(copyInput);
  }

  const inbound: InboundMessage = {
    routingKey: testRequest.routing_key,
    content,
    msgId,
    rootId: msgId,
    senderId: testRequest.sender_id,
    ts: Date.now(),
  };

  const replyPromise = options.sender.register(msgId);
  await options.runner.dispatch(inbound);
  const reply = await withTimeout(
    replyPromise,
    options.replyTimeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let sessionId = "";
  if (options.sessionManager) {
    const session = await options.sessionManager.getOrCreate(testRequest.routing_key);
    sessionId = session.id;
  }

  const response: TestResponse = {
    msg_id: msgId,
    reply,
    session_id: sessionId,
    duration_ms: Math.round(performance.now() - started),
    skills_called: [],
  };
  return jsonResponse(response);
}

async function handleDeleteSessions(
  options: TestServerOptions,
): Promise<Response> {
  if (options.sessionManager) {
    await options.sessionManager.clearAll();
  }
  return jsonResponse({ status: "ok" });
}

export async function copyAttachment(input: {
  attachmentPath: string;
  fileName?: string;
  sessionId: string;
  workspaceDir?: string;
  originalText: string;
}): Promise<string> {
  const src = Bun.file(input.attachmentPath);
  if (!(await src.exists())) {
    return `（附件文件不存在：${input.attachmentPath}）`;
  }

  const actualName = input.fileName ?? basename(input.attachmentPath);
  const workspaceDir = input.workspaceDir ?? "data/workspace";
  const uploadsDir = join(workspaceDir, "sessions", input.sessionId, "uploads");
  await mkdir(uploadsDir, { recursive: true });
  await copyFile(input.attachmentPath, join(uploadsDir, actualName));

  const sandboxPath = `/workspace/sessions/${input.sessionId}/uploads/${actualName}`;
  let hint = [
    "用户发来了文件，已自动保存至沙盒路径：",
    `\`${sandboxPath}\``,
    "请根据文件内容和用户意图完成相应处理。",
  ].join("\n");
  if (input.originalText) {
    hint += `\n（用户备注：${input.originalText}）`;
  }
  return hint;
}

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function makeTestMessageId(): string {
  return `test_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function safeRecordHttp(
  options: TestServerOptions,
  input: {
    path: string;
    method: string;
    statusCode: number;
    durationMs: number;
  },
): void {
  try {
    options.metrics?.recordHttpRequest(input);
  } catch {
    // Observability must never break TestAPI.
  }
}

function safeRecordError(
  options: TestServerOptions,
  component: string,
  error: unknown,
): void {
  try {
    options.metrics?.recordError(component, error instanceof Error ? error.name : typeof error);
  } catch {
    // Observability must never break TestAPI.
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`等待 Bot 回复超时: ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
