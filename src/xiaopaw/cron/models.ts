import * as z from "zod";

export type CronScheduleKind = "at" | "every" | "cron";

export type CronSchedule = {
  kind: CronScheduleKind;
  at_ms: number | null;
  every_ms: number | null;
  expr: string | null;
  tz: string | null;
};

export type CronPayload = {
  routing_key: string;
  message: string;
};

export type CronState = {
  next_run_at_ms: number | null;
  last_run_at_ms: number | null;
  last_status: "ok" | "error" | null;
  last_error: string | null;
};

export type CronJob = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  state: CronState;
  created_at_ms: number;
  updated_at_ms: number;
  delete_after_run: boolean;
};

export type CronStore = {
  version: number;
  jobs: CronJob[];
};

const nullableNumberSchema = z
  .number()
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const nullableStringSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null);

export const cronScheduleSchema = z.object({
  kind: z.enum(["at", "every", "cron"]),
  at_ms: nullableNumberSchema,
  every_ms: nullableNumberSchema,
  expr: nullableStringSchema,
  tz: nullableStringSchema,
});

export const cronPayloadSchema = z.object({
  routing_key: z.string(),
  message: z.string(),
});

export const cronStateSchema = z
  .object({
    next_run_at_ms: nullableNumberSchema,
    last_run_at_ms: nullableNumberSchema,
    last_status: z.enum(["ok", "error"]).nullable().optional().default(null),
    last_error: nullableStringSchema,
  })
  .default({
    next_run_at_ms: null,
    last_run_at_ms: null,
    last_status: null,
    last_error: null,
  });

export const cronJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  schedule: cronScheduleSchema,
  payload: cronPayloadSchema,
  state: cronStateSchema,
  created_at_ms: z.number().default(0),
  updated_at_ms: z.number().default(0),
  delete_after_run: z.boolean().default(false),
});

export const cronStoreSchema = z.object({
  version: z.number().default(1),
  jobs: z.array(cronJobSchema).default([]),
});
