import type { InboundMessage, SenderProtocol } from "./models.ts";
import type { FeishuDownloader } from "./feishu/downloader.ts";
import type { MessageEntry } from "./session/models.ts";
import { SessionManager } from "./session/manager.ts";

export type AgentFn = (
  userMessage: string,
  history: MessageEntry[],
  sessionId: string,
  routingKey: string,
  rootId: string,
  verbose: boolean,
) => Promise<string>;

export interface RunnerMetrics {
  setRunnerWorkerActive(routingKey: string, active: boolean): void;
  setRunnerQueueSize(routingKey: string, size: number): void;
  recordError(component: string, errorType: string): void;
}

type QueueState = {
  queue: InboundMessage[];
  processing: boolean;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
};

export interface RunnerOptions {
  sessionManager: SessionManager;
  sender: SenderProtocol;
  agentFn?: AgentFn;
  idleTimeoutMs?: number;
  downloader?: Pick<FeishuDownloader, "download">;
  metrics?: RunnerMetrics;
}

const HELP_TEXT = [
  "可用命令：",
  "/new — 创建新对话（清除历史上下文）",
  "/verbose on|off — 开启/关闭详细模式（显示推理过程）",
  "/verbose — 查询当前详细模式状态",
  "/status — 查看当前对话信息",
  "/help — 显示本帮助",
].join("\n");

const SLASH_COMMANDS = new Set(["/new", "/verbose", "/help", "/status"]);

export class Runner {
  private readonly sessionManager: SessionManager;
  private readonly sender: SenderProtocol;
  private readonly agentFn: AgentFn;
  private readonly idleTimeoutMs: number;
  private readonly downloader: Pick<FeishuDownloader, "download"> | undefined;
  private readonly metrics: RunnerMetrics | undefined;
  private readonly queues = new Map<string, QueueState>();

  constructor(options: RunnerOptions) {
    this.sessionManager = options.sessionManager;
    this.sender = options.sender;
    this.agentFn = options.agentFn ?? defaultAgentFn;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 300_000;
    this.downloader = options.downloader;
    this.metrics = options.metrics;
  }

  async dispatch(inbound: InboundMessage): Promise<void> {
    const state = this.getQueueState(inbound.routingKey);
    state.queue.push(inbound);
    this.safeSetQueueSize(inbound.routingKey, state.queue.length);

    if (!state.processing) {
      state.processing = true;
      this.safeSetWorkerActive(inbound.routingKey, true);
      queueMicrotask(() => {
        void this.processQueue(inbound.routingKey, state);
      });
    }
  }

  async shutdown(): Promise<void> {
    for (const [routingKey, state] of this.queues.entries()) {
      if (state.idleTimer) {
        clearTimeout(state.idleTimer);
      }
      state.queue.length = 0;
      state.processing = false;
      this.safeSetQueueSize(routingKey, 0);
      this.safeSetWorkerActive(routingKey, false);
    }
    this.queues.clear();
  }

  private getQueueState(routingKey: string): QueueState {
    const existing = this.queues.get(routingKey);
    if (existing) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = undefined;
      }
      return existing;
    }

    const state: QueueState = { queue: [], processing: false, idleTimer: undefined };
    this.queues.set(routingKey, state);
    return state;
  }

  private async processQueue(
    routingKey: string,
    state: QueueState,
  ): Promise<void> {
    while (state.queue.length > 0) {
      const inbound = state.queue.shift();
      this.safeSetQueueSize(routingKey, state.queue.length);
      if (!inbound) {
        continue;
      }

      try {
        await this.handle(inbound);
      } catch (error) {
        console.error(`[${routingKey}] handle error`, error);
        this.safeRecordError("runner", error);
        try {
          await this.sender.send(
            routingKey,
            "处理出错，请稍后重试。",
            inbound.rootId,
          );
        } catch (sendError) {
          console.error(`[${routingKey}] failed to send error message`, sendError);
          this.safeRecordError("sender", sendError);
        }
      }
    }

    state.processing = false;
    this.safeSetWorkerActive(routingKey, false);
    state.idleTimer = setTimeout(() => {
      if (!state.processing && state.queue.length === 0) {
        this.queues.delete(routingKey);
      }
    }, this.idleTimeoutMs);
  }

  private async handle(inbound: InboundMessage): Promise<void> {
    const slashReply = await this.handleSlash(inbound);
    if (slashReply !== null) {
      await this.sender.sendText(
        inbound.routingKey,
        slashReply,
        inbound.rootId,
      );
      return;
    }

    const session = await this.sessionManager.getOrCreate(inbound.routingKey);
    let userContent = inbound.content;

    if (inbound.attachment && this.downloader) {
      const sandboxPath = `/workspace/sessions/${session.id}/uploads/${inbound.attachment.fileName}`;
      const localPath = await this.downloader.download(
        inbound.msgId,
        inbound.attachment,
        session.id,
      );
      userContent = localPath
        ? buildAttachmentMessage(sandboxPath, inbound.content)
        : `[附件下载失败] ${inbound.content}`.trim();
    }

    const history = await this.sessionManager.loadHistory(session.id);
    const cardMsgId = await this.sender.sendThinking(
      inbound.routingKey,
      inbound.rootId,
    );

    const reply = await this.agentFn(
      userContent,
      history,
      session.id,
      inbound.routingKey,
      inbound.rootId,
      session.verbose,
    );

    await this.sessionManager.append({
      sessionId: session.id,
      user: userContent,
      feishuMsgId: inbound.msgId,
      assistant: reply,
    });

    if (cardMsgId) {
      try {
        await this.sender.updateCard(cardMsgId, reply);
        return;
      } catch (error) {
        console.warn("updateCard failed, falling back to send", error);
        this.safeRecordError("sender", error);
      }
    }

    await this.sender.send(inbound.routingKey, reply, inbound.rootId);
  }

  private async handleSlash(inbound: InboundMessage): Promise<string | null> {
    const text = inbound.content.trim();
    if (!text.startsWith("/")) {
      return null;
    }

    const [rawCommand, ...rest] = text.split(/\s+/);
    const command = rawCommand?.toLowerCase() ?? "";
    const arg = rest.join(" ").trim().toLowerCase();

    if (!SLASH_COMMANDS.has(command)) {
      return null;
    }

    if (command === "/new") {
      const session = await this.sessionManager.createNewSession(
        inbound.routingKey,
      );
      return `已创建新对话 ${session.id}，之前的历史不会带入。`;
    }

    if (command === "/verbose") {
      if (arg === "on") {
        await this.sessionManager.getOrCreate(inbound.routingKey);
        await this.sessionManager.updateVerbose(inbound.routingKey, true);
        return "详细模式已开启，我会把推理过程发给你。";
      }
      if (arg === "off") {
        await this.sessionManager.getOrCreate(inbound.routingKey);
        await this.sessionManager.updateVerbose(inbound.routingKey, false);
        return "详细模式已关闭。";
      }
      const session = await this.sessionManager.getOrCreate(inbound.routingKey);
      return `当前详细模式：${session.verbose ? "开启" : "关闭"}`;
    }

    if (command === "/help") {
      return HELP_TEXT;
    }

    if (command === "/status") {
      const session = await this.sessionManager.getOrCreate(inbound.routingKey);
      return [
        `当前对话：${session.id}`,
        `消息数：${session.messageCount}`,
        `详细模式：${session.verbose ? "开启" : "关闭"}`,
      ].join("\n");
    }

    return null;
  }

  private safeSetWorkerActive(routingKey: string, active: boolean): void {
    try {
      this.metrics?.setRunnerWorkerActive(routingKey, active);
    } catch {
      // Observability must never block message handling.
    }
  }

  private safeSetQueueSize(routingKey: string, size: number): void {
    try {
      this.metrics?.setRunnerQueueSize(routingKey, size);
    } catch {
      // Observability must never block message handling.
    }
  }

  private safeRecordError(component: string, error: unknown): void {
    try {
      this.metrics?.recordError(component, errorName(error));
    } catch {
      // Observability must never block message handling.
    }
  }
}

export function buildAttachmentMessage(
  sandboxPath: string,
  originalText: string,
): string {
  let message = [
    "用户发来了文件，已自动保存至沙盒路径：",
    `\`${sandboxPath}\``,
    "请根据文件内容和用户意图完成相应处理。",
  ].join("\n");

  if (originalText.trim()) {
    message += `\n用户备注：${originalText}`;
  }

  return message;
}

async function defaultAgentFn(): Promise<string> {
  throw new Error("agentFn not configured");
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
