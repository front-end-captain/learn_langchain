import path from "node:path";
import url from "node:url";
import { useEffect, useState } from "react";
import { Box, Newline, render, Text, useApp } from "ink";
import { createImageAnalysisFileLogger } from "../../helper/file-logger";
import {
  defaultImagePath,
  runImageAnalysisWithStream,
  type ImageAnalysis,
  type ImageAnalysisStreamEvent,
} from "./agent";

type RunStatus = "idle" | "running" | "done" | "error";

const imagePath = process.argv[2] ?? defaultImagePath;

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function App() {
  const { exit } = useApp();
  const [status, setStatus] = useState<RunStatus>("idle");
  const [currentStep, setCurrentStep] = useState("准备开始分析图片...");
  const [logFilePath, setLogFilePath] = useState<string | null>(null);
  const [prettyLogFilePath, setPrettyLogFilePath] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setStatus("running");

    const fileLogger = createImageAnalysisFileLogger({
      logDir: __dirname,
      format: "both",
    });
    setLogFilePath(fileLogger.logFilePath);
    setPrettyLogFilePath(fileLogger.prettyLogFilePath ?? null);
    fileLogger.writeRunStart({ imagePath });

    runImageAnalysisWithStream(imagePath, (event) => {
      setCurrentStep(formatStreamEvent(event));
      fileLogger.writeEvent(event);
    })
      .then((result) => {
        fileLogger.writeRunEnd({
          status: "success",
          analysis: result,
        });
        setAnalysis(result);
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
        imagePath={imagePath}
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

  if (!analysis) {
    return <Text color="red">未获取到结构化输出</Text>;
  }

  return (
    <ImageAnalysisReport
      analysis={analysis}
      logFilePath={logFilePath}
      prettyLogFilePath={prettyLogFilePath}
    />
  );
}

function RunningView({
  imagePath: currentImagePath,
  currentStep,
  logFilePath,
  prettyLogFilePath,
}: {
  imagePath: string;
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
        正在执行多模态视觉分析任务
      </Text>
      <Text color="gray">图片路径：{currentImagePath}</Text>
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

function ImageAnalysisReport({
  analysis,
  logFilePath,
  prettyLogFilePath,
}: {
  analysis: ImageAnalysis;
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
        多模态视觉分析报告
      </Text>
      <LogFilePathView
        logFilePath={logFilePath}
        prettyLogFilePath={prettyLogFilePath}
      />

      <Newline />

      <Field label="图片文件名" value={analysis.fileName} />
      <Field label="主体内容描述" value={analysis.subjectDescription} />
      <Field label="风格氛围" value={analysis.atmosphereVibe} />

      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow" bold>
          视觉细节列表
        </Text>
        {analysis.visualDetails.map((detail, index) => (
          <Text key={`${index}-${detail}`}>
            <Text color="gray"> {index + 1}. </Text>
            {detail}
          </Text>
        ))}
      </Box>

      <Field label="质量评分" value={analysis.imageQualityScore} />
      <Field label="视觉锚点" value={analysis.highlightFeature} />
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

function formatStreamEvent(event: ImageAnalysisStreamEvent) {
  if (event.type === "agent_update") {
    return `Agent 状态更新：${event.messageType ?? "unknown"}`;
  }

  if (event.type === "tool_calls") {
    const toolNames = event.toolCalls
      .map((toolCall) => toolCall.name)
      .join("、");

    return `正在调用工具：${toolNames}`;
  }

  return "结构化视觉分析报告已生成";
}

render(<App />);
