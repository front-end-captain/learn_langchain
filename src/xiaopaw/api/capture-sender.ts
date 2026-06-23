import type { SenderProtocol } from "../models.ts";

const THINKING_STUB_ID = "test-card-thinking-001";

type PendingReply = {
  promise: Promise<string>;
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
};

export class CaptureSender implements SenderProtocol {
  private readonly futures = new Map<string, PendingReply>();

  register(msgId: string): Promise<string> {
    const pending = createPendingReply();
    this.futures.set(msgId, pending);
    return pending.promise;
  }

  async send(_routingKey: string, content: string, rootId: string): Promise<void> {
    const pending = this.futures.get(rootId);
    if (!pending) {
      return;
    }
    this.futures.delete(rootId);
    pending.resolve(content);
  }

  async sendThinking(
    _routingKey: string,
    _rootId: string,
  ): Promise<string | null> {
    return THINKING_STUB_ID;
  }

  async updateCard(_cardMsgId: string, content: string): Promise<void> {
    const first = this.futures.entries().next();
    if (first.done) {
      return;
    }

    const [msgId, pending] = first.value;
    this.futures.delete(msgId);
    pending.resolve(content);
  }

  async sendText(
    _routingKey: string,
    _content: string,
    _rootId: string,
  ): Promise<void> {
    // Slash 命令纯文本回复不捕获为 TestAPI 的 Agent 最终回复。
  }

  waitForReply(msgId: string, timeoutMs: number): Promise<string> {
    const pending = this.futures.get(msgId);
    if (!pending) {
      throw new Error(`msg_id ${msgId} 未注册`);
    }

    return withTimeout(pending.promise, timeoutMs, () => {
      this.futures.delete(msgId);
      pending.reject(new Error(`等待回复超时: ${msgId}`));
    });
  }
}

function createPendingReply(): PendingReply {
  let resolve!: (value: string) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          onTimeout();
          reject(new Error(`Promise timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
