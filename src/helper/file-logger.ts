import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino, { type Logger } from "pino";
import type {
  ImageAnalysis,
  ImageAnalysisStreamEvent,
} from "../course_01/lesson4/agent";

type RunEndStatus = "success" | "error";
type LogFormat = "jsonl" | "pretty" | "both";

type LoggerTarget = {
  logFilePath: string;
  logger: Logger;
  close: () => void;
};

export type ImageAnalysisFileLogger = {
  logFilePath: string;
  prettyLogFilePath?: string;
  writeRunStart: (input: { imagePath: string }) => void;
  writeEvent: (event: ImageAnalysisStreamEvent) => void;
  writeRunEnd: (input: {
    status: RunEndStatus;
    analysis?: ImageAnalysis;
    error?: unknown;
  }) => void;
  close: () => void;
};

export function createImageAnalysisFileLogger(options: {
  logDir: string;
  runId?: string;
  format?: LogFormat;
}): ImageAnalysisFileLogger {
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

  const logger: ImageAnalysisFileLogger = {
    logFilePath: jsonlTarget?.logFilePath ?? prettyTarget?.logFilePath ?? "",
    prettyLogFilePath: prettyTarget?.logFilePath ?? "",

    writeRunStart(input) {
      writeInfo(
        {
          type: "run_start",
          imagePath: input.imagePath,
        },
        "image_analysis_run_start",
      );
    },

    writeEvent(event) {
      writeInfo(
        {
          type: event.type,
          ...normalizeEventForLog(event),
        },
        "image_analysis_stream_event",
      );
    },

    writeRunEnd(input) {
      writeInfo(
        {
          type: "run_end",
          status: input.status,
          analysis: input.analysis,
          error: input.error ? serializeError(input.error) : undefined,
        },
        "image_analysis_run_end",
      );
    },

    close() {
      for (const target of targets) {
        target.close();
      }
    },
  };

  return logger;
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

function normalizeEventForLog(event: ImageAnalysisStreamEvent) {
  if (event.type === "agent_update") {
    return {
      messageType: event.messageType,
      content: event.content,
    };
  }

  if (event.type === "tool_calls") {
    return {
      toolCalls: event.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.args,
      })),
    };
  }

  return {
    analysis: event.analysis,
  };
}

function serializeError(error: unknown) {
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

function createRunId() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}
