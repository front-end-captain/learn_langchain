import { useEffect, useState } from "react";
import { Box, Newline, Text, useApp } from "ink";
import {
  formatAgentStreamEvent,
  normalizeAgentStreamEventForLog,
  type AgentStreamEventHandler,
} from "../helper/agent-stream";
import {
  createAgentRunFileLogger,
  type LogFormat,
} from "../helper/file-logger";
// import { userPrompt, run } from "./agent";

type RunStatus = "idle" | "running" | "done" | "error";

// const input = process.argv[2] ?? "今天北京天气怎么样";

interface RunResult {
  type: string | undefined;
  message: string | undefined;
}
interface AppProps {
  input: string;
  runName: string;
  logDir: string;
  logFormat: LogFormat;
  run: (input: string, onEvent?: AgentStreamEventHandler) => Promise<RunResult>;
}
export const App: React.FC<AppProps> = (props) => {
  const { exit } = useApp();
  const [status, setStatus] = useState<RunStatus>("idle");
  const [currentStep, setCurrentStep] = useState("开始执行...");
  const [logFilePath, setLogFilePath] = useState<string | null>(null);
  const [prettyLogFilePath, setPrettyLogFilePath] = useState<string | null>(
    null,
  );
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setStatus("running");

    const fileLogger = createAgentRunFileLogger({
      logDir: props.logDir,
      runName: props.runName,
      format: props.logFormat,
    });
    setLogFilePath(fileLogger.logFilePath);
    setPrettyLogFilePath(fileLogger.prettyLogFilePath ?? null);
    fileLogger.writeRunStart({ input: props.input });

    props
      .run(props.input, (event) => {
        setCurrentStep(formatAgentStreamEvent(event));
        fileLogger.writeEvent(normalizeAgentStreamEventForLog(event));
      })
      .then((lessonResult) => {
        fileLogger.writeRunEnd({
          status: "success",
          result: lessonResult,
        });
        setResult(lessonResult);
        setStatus("done");
      })
      .catch((caughtError: unknown) => {
        fileLogger.writeRunEnd({
          status: "error",
          error: caughtError,
        });
        setError(
          caughtError instanceof Error
            ? caughtError
            : new Error(String(caughtError)),
        );
        setStatus("error");
      })
      .finally(() => {
        fileLogger.close();
      });
  }, []);

  useEffect(() => {
    if (status !== "done" && status !== "error") {
      return;
    }

    const timeout = setTimeout(() => {
      exit();
    }, 500);

    return () => clearTimeout(timeout);
  }, [status, exit]);

  if (status === "idle" || status === "running") {
    return (
      <RunningView
        input={props.input}
        currentStep={currentStep}
        logFilePath={logFilePath}
        prettyLogFilePath={prettyLogFilePath}
      />
    );
  }

  if (status === "error") {
    return (
      <ErrorView
        error={error}
        logFilePath={logFilePath}
        prettyLogFilePath={prettyLogFilePath}
      />
    );
  }

  if (!result) {
    return <Text color="red">未获取到输出</Text>;
  }

  return (
    <Lesson1ResultView
      result={result}
      logFilePath={logFilePath}
      prettyLogFilePath={prettyLogFilePath}
    />
  );
};

function RunningView({
  input: currentInput,
  currentStep,
  logFilePath,
  prettyLogFilePath,
}: {
  input: string;
  currentStep: string;
  logFilePath: string | null;
  prettyLogFilePath: string | null;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="blue"
      paddingX={2}
      paddingY={1}
    >
      <Text color="blue" bold>
        正在执行
      </Text>
      <Text color="gray">输入：{currentInput}</Text>
      <LogFilePathView
        logFilePath={logFilePath}
        prettyLogFilePath={prettyLogFilePath}
      />
      <Newline />
      <Text>{currentStep}</Text>
    </Box>
  );
}

function ErrorView({
  error,
  logFilePath,
  prettyLogFilePath,
}: {
  error: Error | null;
  logFilePath: string | null;
  prettyLogFilePath: string | null;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="red"
      paddingX={2}
      paddingY={1}
    >
      <Text color="red" bold>
        执行失败
      </Text>
      <Text>{error?.message ?? "未知错误"}</Text>
      <LogFilePathView
        logFilePath={logFilePath}
        prettyLogFilePath={prettyLogFilePath}
      />
    </Box>
  );
}

function Lesson1ResultView({
  result,
  logFilePath,
  prettyLogFilePath,
}: {
  result: RunResult;
  logFilePath: string | null;
  prettyLogFilePath: string | null;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Text color="cyan" bold>
        内容输出
      </Text>
      <LogFilePathView
        logFilePath={logFilePath}
        prettyLogFilePath={prettyLogFilePath}
      />
      <Newline />
      <Text color="yellow" bold>
        最终消息类型
      </Text>
      <Text>{result.type ?? "unknown"}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow" bold>
          最终输出
        </Text>
        <Text>{formatContent(result.message)}</Text>
      </Box>
    </Box>
  );
}

function LogFilePathView({
  logFilePath,
  prettyLogFilePath,
}: {
  logFilePath: string | null;
  prettyLogFilePath: string | null;
}) {
  if (!logFilePath && !prettyLogFilePath) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {prettyLogFilePath ? (
        <Text color="gray">格式化日志：{prettyLogFilePath}</Text>
      ) : null}
      {logFilePath ? <Text color="gray">JSONL 日志：{logFilePath}</Text> : null}
    </Box>
  );
}

function formatContent(content: unknown) {
  return typeof content === "string"
    ? content
    : JSON.stringify(content, null, 2);
}
