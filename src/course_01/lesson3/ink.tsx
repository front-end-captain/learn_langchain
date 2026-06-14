import path from "node:path";
import url from "node:url";
import { useEffect, useState } from "react";
import { Box, Newline, render, Text, useApp } from "ink";
import { createAgentRunFileLogger } from "../../helper/file-logger";
import {
  defaultVisualReport,
  formatLesson3WorkflowEvent,
  getStepLabel,
  normalizeLesson3WorkflowEventForLog,
  runLesson3WorkflowWithStream,
  type Lesson3WorkflowEvent,
  type Lesson3WorkflowResult,
  type Lesson3WorkflowStep,
} from "./workflow";

type RunStatus = "idle" | "running" | "done" | "error";
type StepStatus = "pending" | "running" | "done";

type StepState = Record<Lesson3WorkflowStep, StepStatus>;

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function App() {
  const { exit } = useApp();
  const [status, setStatus] = useState<RunStatus>("idle");
  const [currentStep, setCurrentStep] = useState("准备开始执行 lesson3...");
  const [stepState, setStepState] = useState<StepState>({
    content_strategy: "pending",
    copywriting: "pending",
    seo_optimization: "pending",
  });
  const [logFilePath, setLogFilePath] = useState<string | null>(null);
  const [prettyLogFilePath, setPrettyLogFilePath] = useState<string | null>(
    null,
  );
  const [result, setResult] = useState<Lesson3WorkflowResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setStatus("running");

    const fileLogger = createAgentRunFileLogger<Lesson3WorkflowResult>({
      logDir: path.join(__dirname, "logs"),
      runName: "lesson3",
      format: "both",
    });
    setLogFilePath(fileLogger.logFilePath);
    setPrettyLogFilePath(fileLogger.prettyLogFilePath ?? null);
    fileLogger.writeRunStart({ report: defaultVisualReport });

    runLesson3WorkflowWithStream(defaultVisualReport, (event) => {
      setCurrentStep(formatLesson3WorkflowEvent(event));
      updateStepState(event, setStepState);
      fileLogger.writeEvent(normalizeLesson3WorkflowEventForLog(event));
    })
      .then((workflowResult) => {
        fileLogger.writeRunEnd({
          status: "success",
          result: workflowResult,
        });
        setResult(workflowResult);
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
        stepState={stepState}
        logFilePath={logFilePath}
        prettyLogFilePath={prettyLogFilePath}
      />
    );
  }

  if (status === "error") {
    return (
      <ErrorView
        error={error}
        stepState={stepState}
        logFilePath={logFilePath}
        prettyLogFilePath={prettyLogFilePath}
      />
    );
  }

  if (!result) {
    return <Text color="red">未获取到 lesson3 workflow 输出</Text>;
  }

  return (
    <WorkflowResultView
      result={result}
      logFilePath={logFilePath}
      prettyLogFilePath={prettyLogFilePath}
    />
  );
}

function RunningView({
  currentStep,
  stepState,
  logFilePath,
  prettyLogFilePath,
}: {
  currentStep: string;
  stepState: StepState;
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
        正在执行 lesson3 Sequential Workflow
      </Text>
      <LogFilePathView
        logFilePath={logFilePath}
        prettyLogFilePath={prettyLogFilePath}
      />
      <Newline />
      <StepList stepState={stepState} />
      <Newline />
      <Text>{currentStep}</Text>
    </Box>
  );
}

function ErrorView({
  error,
  stepState,
  logFilePath,
  prettyLogFilePath,
}: {
  error: Error | null;
  stepState: StepState;
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
      <StepList stepState={stepState} />
    </Box>
  );
}

function WorkflowResultView({
  result,
  logFilePath,
  prettyLogFilePath,
}: {
  result: Lesson3WorkflowResult;
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
        lesson3 SEO 优化最终报告
      </Text>
      <LogFilePathView
        logFilePath={logFilePath}
        prettyLogFilePath={prettyLogFilePath}
      />
      <Newline />
      <Field label="优化后的标题" value={result.finalReport.optimizedTitle} />
      <Field label="优化后的正文" value={result.finalReport.optimizedContent} />
      <ListField label="标签" values={result.finalReport.tags} />
      <Field label="优化总结" value={result.finalReport.optimizationSummary} />
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow" bold>
          任务输出摘要
        </Text>
        {result.tasksOutput.map((taskOutput, index) => (
          <Text key={taskOutput.taskName}>
            <Text color="gray"> {index + 1}. </Text>
            {taskOutput.taskName} / {taskOutput.outputType} /{" "}
            {JSON.stringify(taskOutput.structuredResponse).length} 字符
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function StepList({ stepState }: { stepState: StepState }) {
  const steps: Lesson3WorkflowStep[] = [
    "content_strategy",
    "copywriting",
    "seo_optimization",
  ];

  return (
    <Box flexDirection="column">
      {steps.map((step, index) => (
        <Text key={step}>
          [{index + 1}/3] {getStepLabel(step)}{" "}
          {formatStepStatus(stepState[step])}
        </Text>
      ))}
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
      {prettyLogFilePath ? (
        <Text color="gray">格式化日志：{prettyLogFilePath}</Text>
      ) : null}
      {logFilePath ? <Text color="gray">JSONL 日志：{logFilePath}</Text> : null}
    </Box>
  );
}

function updateStepState(
  event: Lesson3WorkflowEvent,
  setStepState: React.Dispatch<React.SetStateAction<StepState>>,
) {
  if (event.type === "step_start") {
    setStepState((previous) => ({ ...previous, [event.step]: "running" }));
    return;
  }

  if (event.type === "step_end") {
    setStepState((previous) => ({ ...previous, [event.step]: "done" }));
  }
}

function formatStepStatus(status: StepStatus) {
  if (status === "done") {
    return "✅ 完成";
  }

  if (status === "running") {
    return "⏳ 执行中";
  }

  return "pending";
}

render(<App />);
