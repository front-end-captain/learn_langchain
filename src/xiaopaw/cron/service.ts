import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CronExpressionParser } from "cron-parser";
import type { InboundMessage } from "../models.ts";
import {
  cronJobSchema,
  type CronJob,
  type CronSchedule,
  type CronState,
} from "./models.ts";

export type CronDispatchFn = (inbound: InboundMessage) => Promise<void>;

export type CronServiceOptions = {
  dataDir: string;
  dispatchFn: CronDispatchFn;
  tickIntervalMs?: number;
  now?: () => number;
};

type StoreFingerprint = {
  mtimeMs: number;
  size: number;
};

const DEFAULT_TICK_INTERVAL_MS = 50;

export class CronService {
  readonly tasksPath: string;

  jobs: CronJob[] = [];

  private readonly dispatchFn: CronDispatchFn;

  private readonly tickIntervalMs: number;

  private readonly now: () => number;

  private disabledJobsRaw: unknown[] = [];

  private fingerprint: StoreFingerprint | null = null;

  private running = false;

  private loopPromise: Promise<void> | null = null;

  constructor(options: CronServiceOptions) {
    this.tasksPath = join(options.dataDir, "cron", "tasks.json");
    this.dispatchFn = options.dispatchFn;
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    await this.loadStore();
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }
  }

  async loadStore(): Promise<void> {
    const fingerprint = await this.readFingerprint();
    if (!fingerprint) {
      this.jobs = [];
      this.disabledJobsRaw = [];
      this.fingerprint = null;
      return;
    }

    try {
      const raw = JSON.parse(await readFile(this.tasksPath, "utf8")) as unknown;
      const jobsRaw = getJobsRaw(raw);
      const enabledJobs: CronJob[] = [];
      const disabledJobsRaw: unknown[] = [];

      for (const jobRaw of jobsRaw) {
        if (!isEnabledRaw(jobRaw)) {
          disabledJobsRaw.push(jobRaw);
          continue;
        }
        enabledJobs.push(cronJobSchema.parse(jobRaw));
      }

      this.jobs = enabledJobs;
      this.disabledJobsRaw = disabledJobsRaw;
      this.fingerprint = fingerprint;
      this.recomputeMissingNextRuns(this.now());
    } catch (error) {
      console.error("Failed to parse tasks.json", error);
      this.jobs = [];
      this.disabledJobsRaw = [];
      this.fingerprint = fingerprint;
    }
  }

  async saveStore(): Promise<void> {
    const enabledRaw = this.jobs.map(jobToRaw);
    const output = {
      version: 1,
      jobs: [...enabledRaw, ...this.disabledJobsRaw],
    };

    await mkdir(dirname(this.tasksPath), { recursive: true });
    const tmpPath = `${this.tasksPath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(output, null, 2), "utf8");
    await rename(tmpPath, this.tasksPath);
    this.fingerprint = await this.readFingerprint();
  }

  async tick(): Promise<void> {
    if (await this.hasStoreChanged()) {
      await this.loadStore();
    }

    const nowMs = this.now();
    const firedIds: string[] = [];

    for (const job of this.jobs) {
      if (job.state.next_run_at_ms !== null && job.state.next_run_at_ms <= nowMs) {
        await this.fire(job, nowMs);
        firedIds.push(job.id);
      }
    }

    if (firedIds.length > 0) {
      this.postFire(firedIds, nowMs);
      await this.saveStore();
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.tick();
      } catch (error) {
        console.error("CronService tick error", error);
      }
      await sleep(this.tickIntervalMs);
    }
  }

  private async fire(job: CronJob, firedAtMs: number): Promise<void> {
    const msgId = `cron_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const inbound: InboundMessage = {
      routingKey: job.payload.routing_key,
      content: job.payload.message,
      msgId,
      rootId: msgId,
      senderId: "cron",
      ts: firedAtMs,
      isCron: true,
    };

    try {
      await this.dispatchFn(inbound);
      job.state.last_status = "ok";
      job.state.last_error = null;
    } catch (error) {
      job.state.last_status = "error";
      job.state.last_error = error instanceof Error ? error.message : String(error);
      console.error(`CronService fire error for job ${job.id}`, error);
    }

    job.state.last_run_at_ms = firedAtMs;
  }

  private postFire(firedIds: string[], firedAtMs: number): void {
    const fired = new Set(firedIds);
    const removeIds = new Set<string>();

    for (const job of this.jobs) {
      if (!fired.has(job.id)) {
        continue;
      }

      if (job.schedule.kind === "at") {
        if (job.delete_after_run) {
          removeIds.add(job.id);
        } else {
          job.enabled = false;
          job.state.next_run_at_ms = null;
        }
      } else if (job.schedule.kind === "every" && job.schedule.every_ms !== null) {
        job.state.next_run_at_ms = firedAtMs + job.schedule.every_ms;
      } else if (job.schedule.kind === "cron" && job.schedule.expr) {
        job.state.next_run_at_ms = nextCronMs(job.schedule, firedAtMs);
      }
    }

    this.jobs = this.jobs.filter((job) => !removeIds.has(job.id));
  }

  private recomputeMissingNextRuns(nowMs: number): void {
    for (const job of this.jobs) {
      if (job.schedule.kind === "cron" && job.schedule.expr) {
        job.state.next_run_at_ms = nextCronMs(job.schedule, nowMs);
        continue;
      }
      if (job.state.next_run_at_ms !== null) {
        continue;
      }
      if (job.schedule.kind === "at" && job.schedule.at_ms !== null) {
        job.state.next_run_at_ms = job.schedule.at_ms;
      } else if (job.schedule.kind === "every" && job.schedule.every_ms !== null) {
        job.state.next_run_at_ms = nowMs + job.schedule.every_ms;
      }
    }
  }

  private async hasStoreChanged(): Promise<boolean> {
    const current = await this.readFingerprint();
    if (!current) {
      return this.fingerprint !== null;
    }
    if (!this.fingerprint) {
      return true;
    }
    return current.mtimeMs !== this.fingerprint.mtimeMs || current.size !== this.fingerprint.size;
  }

  private async readFingerprint(): Promise<StoreFingerprint | null> {
    try {
      const fileStat = await stat(this.tasksPath);
      return {
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }
}

export function nextCronMs(
  schedule: Pick<CronSchedule, "expr" | "tz">,
  fromMs: number = Date.now(),
): number {
  if (!schedule.expr) {
    throw new Error("cron schedule expr is required");
  }
  const cron = CronExpressionParser.parse(schedule.expr, {
    currentDate: new Date(fromMs),
    tz: schedule.tz ?? "UTC",
  });
  return cron.next().getTime();
}

function getJobsRaw(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("tasks.json root is not an object");
  }
  const jobs = (raw as Record<string, unknown>)["jobs"];
  if (!Array.isArray(jobs)) {
    throw new Error("tasks.json.jobs is not an array");
  }
  return jobs;
}

function isEnabledRaw(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return true;
  }
  return (raw as Record<string, unknown>)["enabled"] !== false;
}

function jobToRaw(job: CronJob): Record<string, unknown> {
  return {
    id: job.id,
    name: job.name,
    enabled: job.enabled,
    schedule: {
      kind: job.schedule.kind,
      at_ms: job.schedule.at_ms,
      every_ms: job.schedule.every_ms,
      expr: job.schedule.expr,
      tz: job.schedule.tz,
    },
    payload: {
      routing_key: job.payload.routing_key,
      message: job.payload.message,
    },
    state: stateToRaw(job.state),
    created_at_ms: job.created_at_ms,
    updated_at_ms: job.updated_at_ms,
    delete_after_run: job.delete_after_run,
  };
}

function stateToRaw(state: CronState): Record<string, unknown> {
  return {
    next_run_at_ms: state.next_run_at_ms,
    last_run_at_ms: state.last_run_at_ms,
    last_status: state.last_status,
    last_error: state.last_error,
  };
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
