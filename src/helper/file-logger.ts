import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino, { type Logger } from "pino";

export type AgentRunStatus = "success" | "error";
export type LogFormat = "jsonl" | "pretty" | "both";

type LoggerTarget = {
  logFilePath: string;
  logger: Logger;
  close: () => void;
};

export type AgentRunFileLogger<TResult> = {
  logFilePath: string;
  prettyLogFilePath?: string;
  writeRunStart: (input: Record<string, unknown>) => void;
  writeEvent: (event: Record<string, unknown>) => void;
  writeRunEnd: (input: {
    status: AgentRunStatus;
    result?: TResult;
    error?: unknown;
  }) => void;
  close: () => void;
};

export function createAgentRunFileLogger<TResult>(options: {
  logDir: string;
  runName: string;
  runId?: string;
  format?: LogFormat;
}): AgentRunFileLogger<TResult> {
  const format = options.format ?? "jsonl";
  const runId = options.runId ?? createRunId();

  mkdirSync(options.logDir, { recursive: true });

  const targets: LoggerTarget[] = [];

  if (format === "jsonl" || format === "both") {
    targets.push(createJsonlLogger(options.logDir, runId));
  }

  if (format === "pretty" || format === "both") {
    targets.push(createPrettyLogger(options.logDir, runId));
  }

  const jsonlTarget = targets.find((target) =>
    target.logFilePath.endsWith(".jsonl"),
  );
  const prettyTarget = targets.find((target) =>
    target.logFilePath.endsWith(".pretty.log"),
  );

  function writeInfo(record: Record<string, unknown>, message: string) {
    for (const target of targets) {
      target.logger.info(record, message);
    }
  }

  return {
    logFilePath: jsonlTarget?.logFilePath ?? prettyTarget?.logFilePath ?? "",
    prettyLogFilePath: prettyTarget?.logFilePath ?? "",

    writeRunStart(input) {
      writeInfo(
        {
          type: "run_start",
          ...input,
        },
        `${options.runName}_run_start`,
      );
    },

    writeEvent(event) {
      writeInfo(event, `${options.runName}_stream_event`);
    },

    writeRunEnd(input) {
      writeInfo(
        {
          type: "run_end",
          status: input.status,
          result: input.result,
          error: input.error ? serializeError(input.error) : undefined,
        },
        `${options.runName}_run_end`,
      );
    },

    close() {
      for (const target of targets) {
        target.close();
      }
    },
  };
}

function createJsonlLogger(logDir: string, runId: string): LoggerTarget {
  const logFilePath = join(logDir, `${runId}.jsonl`);
  const destination = pino.destination({
    dest: logFilePath,
    sync: false,
  });
  const logger = pino(
    {
      level: "info",
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );

  return {
    logFilePath,
    logger,
    close() {
      destination.flushSync();
      destination.end();
    },
  };
}

function createPrettyLogger(logDir: string, runId: string): LoggerTarget {
  const logFilePath = join(logDir, `${runId}.pretty.log`);
  const transport = pino.transport({
    target: "pino-pretty",
    options: {
      destination: logFilePath,
      colorize: false,
      translateTime: "yyyy-mm-dd HH:MM:ss.l",
      ignore: "pid,hostname",
      singleLine: false,
    },
  });
  const logger = pino(
    {
      level: "info",
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    transport,
  );

  return {
    logFilePath,
    logger,
    close() {
      transport.flushSync();
      transport.end();
    },
  };
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createRunId() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}
