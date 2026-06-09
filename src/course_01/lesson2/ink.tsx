import path from "node:path";
import url from "node:url";
import { useEffect, useState } from "react";
import { Box, Newline, render, Text, useApp } from "ink";
import {
  formatAgentStreamEvent,
  normalizeAgentStreamEventForLog,
} from "../../helper/agent-stream";
import { createAgentRunFileLogger } from "../../helper/file-logger";
import {
  defaultVisualReport,
  runLesson2WithStream,
  type ContentStrategyBrief,
  type Lesson2StreamEvent,
} from "./agent";

type RunStatus = "idle" | "running" | "done" | "error";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function App() {
  const { exit } = useApp();
  const [status, setStatus] = useState<RunStatus>("idle");
  const [currentStep, setCurrentStep] = useState("准备开始执行 lesson2...");
  const [logFilePath, setLogFilePath] = useState<string | null>(null);
  const [prettyLogFilePath, setPrettyLogFilePath] = useState<string | null>(null);
  const [brief, setBrief] = useState<ContentStrategyBrief | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setStatus("running");

    const fileLogger = createAgentRunFileLogger<Lesson2StreamEvent, ContentStrategyBrief>({
      logDir: path.join(__dirname, "logs"),
      runName: "lesson2",
      format: "both",
      normalizeEvent: normalizeAgentStreamEventForLog,
    });
    setLogFilePath(fileLogger.logFilePath);
    setPrettyLogFilePath(fileLogger.prettyLogFilePath ?? null);
    fileLogger.writeRunStart({ report: defaultVisualReport });

    runLesson2WithStream(defaultVisualReport, (event) => {
      setCurrentStep(formatAgentStreamEvent(event));
      fileLogger.writeEvent(event);
    })
      .then((result) => {
        fileLogger.writeRunEnd({
          status: "success",
          result,
        });
        setBrief(result);
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

  if (!brief) {
    return <Text color="red">未获取到 ContentStrategyBrief 输出</Text>;
  }

  return (
    <ContentStrategyBriefView
      brief={brief}
      logFilePath={logFilePath}
      prettyLogFilePath={prettyLogFilePath}
    />
  );
}

function RunningView({
  currentStep,
  logFilePath,
  prettyLogFilePath,
}: {
  currentStep: string;
  logFilePath: string | null;
  prettyLogFilePath: string | null;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={2} paddingY={1}>
      <Text color="blue" bold>
        正在执行 lesson2 结构化内容策略任务
      </Text>
      <LogFilePathView logFilePath={logFilePath} prettyLogFilePath={prettyLogFilePath} />
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
    <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={2} paddingY={1}>
      <Text color="red" bold>
        执行失败
      </Text>
      <Text>{error?.message ?? "未知错误"}</Text>
      <LogFilePathView logFilePath={logFilePath} prettyLogFilePath={prettyLogFilePath} />
    </Box>
  );
}

function ContentStrategyBriefView({
  brief,
  logFilePath,
  prettyLogFilePath,
}: {
  brief: ContentStrategyBrief;
  logFilePath: string | null;
  prettyLogFilePath: string | null;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
      <Text color="cyan" bold>
        lesson2 内容策略简报
      </Text>
      <LogFilePathView logFilePath={logFilePath} prettyLogFilePath={prettyLogFilePath} />
      <Newline />
      <Field label="素材评估" value={brief.inputEvaluation} />
      <Field label="目标受众画像" value={brief.targetAudiencePersona} />
      <Field label="核心痛点" value={brief.corePainPoint} />
      <Field label="建议标题" value={brief.suggestedTitle} />
      <ListField label="笔记大纲" values={brief.contentOutline} />
      <Field label="互动策略" value={brief.engagementStrategy} />
      <Field label="收藏策略" value={brief.retentionStrategy} />
      <ListField label="SEO 关键词" values={brief.seoKeywords} />
    </Box>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>
        {label}
      </Text>
      <Text>{value}</Text>
    </Box>
  );
}

function ListField({ label, values }: { label: string; values: string[] }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>
        {label}
      </Text>
      {values.map((value, index) => (
        <Text key={`${index}-${value}`}>
          <Text color="gray"> {index + 1}. </Text>
          {value}
        </Text>
      ))}
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
      {prettyLogFilePath ? <Text color="gray">格式化日志：{prettyLogFilePath}</Text> : null}
      {logFilePath ? <Text color="gray">JSONL 日志：{logFilePath}</Text> : null}
    </Box>
  );
}

render(<App />);
