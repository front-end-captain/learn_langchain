import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InboundMessage } from "../models.ts";
import { CronService, nextCronMs } from "./service.ts";

type JobInput = {
  id: string;
  name?: string;
  enabled?: boolean;
  schedule: Record<string, unknown>;
  message?: string;
  nextRunAtMs?: number | null;
  deleteAfterRun?: boolean;
};

async function writeStore(dataDir: string, jobs: unknown[]): Promise<void> {
  await writeFile(
    join(dataDir, "cron", "tasks.json"),
    JSON.stringify({ version: 1, jobs }, null, 2),
    "utf8",
  );
}

function createJob(input: JobInput): Record<string, unknown> {
  return {
    id: input.id,
    name: input.name ?? input.id,
    enabled: input.enabled ?? true,
    schedule: input.schedule,
    payload: {
      routing_key: "p2p:ou_cron",
      message: input.message ?? `message:${input.id}`,
    },
    state: {
      next_run_at_ms: input.nextRunAtMs ?? null,
      last_run_at_ms: null,
      last_status: null,
      last_error: null,
    },
    created_at_ms: 1,
    updated_at_ms: 1,
    delete_after_run: input.deleteAfterRun ?? false,
  };
}

describe("CronService", () => {
  let tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs = [];
  });

  async function createDataDir(): Promise<string> {
    const dataDir = await mkdtemp(join(tmpdir(), "xiaopaw-cron-"));
    tempDirs.push(dataDir);
    await Bun.write(join(dataDir, "cron", ".keep"), "");
    return dataDir;
  }

  it("fires an at job by dispatching a cron inbound message", async () => {
    const dataDir = await createDataDir();
    await writeStore(dataDir, [
      createJob({
        id: "at-1",
        schedule: { kind: "at", at_ms: 1_000, every_ms: null, expr: null, tz: null },
        nextRunAtMs: null,
      }),
    ]);
    const dispatched: InboundMessage[] = [];
    const service = new CronService({
      dataDir,
      now: () => 1_000,
      dispatchFn: async (inbound) => {
        dispatched.push(inbound);
      },
    });

    await service.loadStore();
    await service.tick();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.routingKey).toBe("p2p:ou_cron");
    expect(dispatched[0]?.content).toBe("message:at-1");
    expect(dispatched[0]?.senderId).toBe("cron");
    expect(dispatched[0]?.isCron).toBe(true);

    const saved = JSON.parse(
      await readFile(join(dataDir, "cron", "tasks.json"), "utf8"),
    ) as { jobs: Array<Record<string, unknown>> };
    expect(saved.jobs[0]?.["enabled"]).toBe(false);
    expect((saved.jobs[0]?.["state"] as Record<string, unknown>)["last_status"]).toBe("ok");
  });

  it("removes one-shot at jobs when delete_after_run is true", async () => {
    const dataDir = await createDataDir();
    await writeStore(dataDir, [
      createJob({
        id: "at-delete",
        schedule: { kind: "at", at_ms: 1_000, every_ms: null, expr: null, tz: null },
        deleteAfterRun: true,
      }),
    ]);
    const service = new CronService({
      dataDir,
      now: () => 1_000,
      dispatchFn: async () => undefined,
    });

    await service.loadStore();
    await service.tick();

    const saved = JSON.parse(
      await readFile(join(dataDir, "cron", "tasks.json"), "utf8"),
    ) as { jobs: unknown[] };
    expect(saved.jobs).toHaveLength(0);
  });

  it("reschedules every jobs after each fire", async () => {
    const dataDir = await createDataDir();
    let now = 1_000;
    const dispatched: InboundMessage[] = [];
    await writeStore(dataDir, [
      createJob({
        id: "every-1",
        schedule: { kind: "every", at_ms: null, every_ms: 100, expr: null, tz: null },
      }),
    ]);
    const service = new CronService({
      dataDir,
      now: () => now,
      dispatchFn: async (inbound) => {
        dispatched.push(inbound);
      },
    });

    await service.loadStore();
    expect(service.jobs[0]?.state.next_run_at_ms).toBe(1_100);

    now = 1_100;
    await service.tick();

    expect(dispatched).toHaveLength(1);
    expect(service.jobs[0]?.state.next_run_at_ms).toBe(1_200);
  });

  it("computes cron next_run_at_ms with cron-parser", async () => {
    const dataDir = await createDataDir();
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    await writeStore(dataDir, [
      createJob({
        id: "cron-1",
        schedule: { kind: "cron", at_ms: null, every_ms: null, expr: "*/5 * * * * *", tz: "UTC" },
      }),
    ]);
    const service = new CronService({
      dataDir,
      now: () => base,
      dispatchFn: async () => undefined,
    });

    await service.loadStore();

    expect(service.jobs[0]?.state.next_run_at_ms).toBe(base + 5_000);
    expect(nextCronMs({ expr: "*/5 * * * * *", tz: "UTC" }, base)).toBe(base + 5_000);
  });

  it("does not fire disabled jobs and preserves them when saving", async () => {
    const dataDir = await createDataDir();
    await writeStore(dataDir, [
      createJob({
        id: "at-enabled",
        schedule: { kind: "at", at_ms: 1_000, every_ms: null, expr: null, tz: null },
      }),
      createJob({
        id: "disabled",
        enabled: false,
        schedule: { kind: "at", at_ms: 1_000, every_ms: null, expr: null, tz: null },
        message: "disabled-message",
      }),
    ]);
    const dispatched: InboundMessage[] = [];
    const service = new CronService({
      dataDir,
      now: () => 1_000,
      dispatchFn: async (inbound) => {
        dispatched.push(inbound);
      },
    });

    await service.loadStore();
    await service.tick();

    expect(dispatched.map((item) => item.content)).toEqual(["message:at-enabled"]);
    const saved = JSON.parse(
      await readFile(join(dataDir, "cron", "tasks.json"), "utf8"),
    ) as { jobs: Array<Record<string, unknown>> };
    expect(saved.jobs.some((job) => job["id"] === "disabled" && job["enabled"] === false)).toBe(true);
  });

  it("hot reloads tasks.json when mtime or size changes", async () => {
    const dataDir = await createDataDir();
    let now = 1_000;
    const dispatched: InboundMessage[] = [];
    await writeStore(dataDir, []);
    const service = new CronService({
      dataDir,
      now: () => now,
      dispatchFn: async (inbound) => {
        dispatched.push(inbound);
      },
    });
    await service.loadStore();

    now = 1_010;
    await writeStore(dataDir, [
      createJob({
        id: "hot",
        schedule: { kind: "at", at_ms: 1_010, every_ms: null, expr: null, tz: null },
        message: "hot-reloaded",
      }),
    ]);

    await service.tick();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.content).toBe("hot-reloaded");
  });

  it("records dispatch errors in job state", async () => {
    const dataDir = await createDataDir();
    await writeStore(dataDir, [
      createJob({
        id: "error-job",
        schedule: { kind: "at", at_ms: 1_000, every_ms: null, expr: null, tz: null },
      }),
    ]);
    const service = new CronService({
      dataDir,
      now: () => 1_000,
      dispatchFn: async () => {
        throw new Error("dispatch failed");
      },
    });

    await service.loadStore();
    await service.tick();

    const saved = JSON.parse(
      await readFile(join(dataDir, "cron", "tasks.json"), "utf8"),
    ) as { jobs: Array<Record<string, unknown>> };
    const state = saved.jobs[0]?.["state"] as Record<string, unknown>;
    expect(state["last_status"]).toBe("error");
    expect(state["last_error"]).toBe("dispatch failed");
  });

  it("start and stop run the tick loop", async () => {
    const dataDir = await createDataDir();
    const dispatched = mock(async () => undefined);
    await writeStore(dataDir, [
      createJob({
        id: "loop-at",
        schedule: { kind: "at", at_ms: Date.now(), every_ms: null, expr: null, tz: null },
      }),
    ]);
    const service = new CronService({
      dataDir,
      tickIntervalMs: 5,
      dispatchFn: dispatched,
    });

    await service.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await service.stop();

    expect(dispatched).toHaveBeenCalled();
  });
});
