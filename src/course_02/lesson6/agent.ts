import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, createMiddleware, ToolMessage } from "langchain";
import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model";
import { fileReadTool, FILE_READ_TOOL_NAME } from "../../tools/file-read-tool";
import {
  fileWriterTool,
  FILE_WRITER_TOOL_NAME,
} from "../../tools/file-writer-tool";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_BASE_PATH = path.resolve(__dirname, "workspace");
const DEMO_USER_ID = "demo-user";

const systemPromot = `
你是： 定时任务管理专家
你的目标： 根据用户需求，记录和维护定时任务情况
你的背景：
你是一位定时任务记录专家，擅长记录和管理需要长期执行的定时任务。

你十分熟悉的掌握以下能力：
Crontab 是一种通过特定的语法定义时间规则来自动执行命令或脚本。其语法由5个时间字段（分、时、日、月、周）和1个命令字段组成，支持*（任意）、,（枚举）、-（范围）和*/n（间隔）等特殊字符。
核心语法格式：
\`\`\`
# 分 时 日 月 周 命令
*  *  *  *  *  command
\`\`\`
其中时间字段说明
字段	含义	范围	特殊字符
M	分钟 (Minute)	0-59	*, -, ,, /
H	小时 (Hour)	0-23	*, -, ,, /
D	日期 (Day of Month)	1-31	*, -, ,, /
m	月份 (Month)	1-12	*, -, ,, /
d	星期 (Day of Week)	0-7	0和7均为星期日

特殊操作符详解：
* (星号)：代表“每”的含义。例如，在月字段中代表每个月。
, (逗号)：分隔多个不连续的数值。例如，周字段为 1,3,5 表示周一、周三、周五。
- (减号)：代表连续的范围。例如，时字段为 9-17 表示上午9点到下午5点。
/ (斜杠)：代表每隔多少个单位执行一次。例如，分字段为 */10 表示每隔10分钟。

常用示例：
每分钟执行：* * * * * command
每5分钟执行：*/5 * * * * command
每小时第0分执行：0 * * * * command
每天凌晨2点执行：0 2 * * * command
每周一上午8:30执行：30 8 * * 1 command
每月1号凌晨0点执行：0 0 1 * * command

你通常的工作方法包括：
1、你会根据用户的需求，生成符合crontab语法的定时任务，并写入到CRONTAB.md文件中，如果文件不存在则创建一个。
其中CRONTAB.md文件的格式为：一行一个的定时任务，每行定时任务的格式符合crontab语法，其中command字段用json格式表式；
示例： * * * * * {{"task_name":"任务名称", "task_description"："任务描述", "expected_output"："预期输出"}}
2、当用户询问或者想要更改、删除定时任务时，你会读取CRONTAB.md文件，如果文件不存在则表示没有定时任务，根据用户需求，回答用户的问题或者调整CRONTAB.md文件中的定时任务。
3、当你回答用户问题和描述任务情况时，你要尽量使用文字描述，回答的语句对用户友好。你也可以用markdown表格形式描述任务情况。

注意：
你不会去具体执行定时任务，你只负责记录和维护定时任务情况。
`;

function createTaskMessage(userInput: string) {
  return `
根据用户的需求，完成对定时任务的记录和维护。用户的输入为：${userInput}
**期望输出**
满足用户需求后，对用户的友好答复
`;
}

function getWorkspacePath(userId: string) {
  return path.resolve(WORKSPACE_BASE_PATH, userId);
}

function isPathWithinBase(basePath: string, targetPath: string) {
  const relativePath = path.relative(basePath, targetPath);

  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

function resolveToolFilePath(inputPath: string, workspacePath: string) {
  const originalPath = path.resolve(inputPath);

  if (isPathWithinBase(workspacePath, originalPath)) {
    return originalPath;
  }

  const redirectedPath = path.resolve(workspacePath, inputPath);

  if (!isPathWithinBase(workspacePath, redirectedPath)) {
    return null;
  }

  return redirectedPath;
}

const llm = new AliyunQwenChatModel({
  model: "qwen3.7-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
  temperature: 0.7,
});

const fileReadAndWriteMiddleware = createMiddleware({
  name: "FileReadAndWriteMiddleware",
  wrapToolCall: async (request, handler) => {
    console.log(`工具调用: ${request.toolCall.name}`);
    console.log(`工具输入: ${JSON.stringify(request.toolCall.args)}`);

    const toolName = request.toolCall.name;
    if (
      toolName !== FILE_READ_TOOL_NAME &&
      toolName !== FILE_WRITER_TOOL_NAME
    ) {
      return handler(request);
    }

    const workspacePath = getWorkspacePath(DEMO_USER_ID);
    await mkdir(workspacePath, { recursive: true });

    const toolArgs = {
      ...request.toolCall.args,
    } as Record<string, unknown>;

    const originalFilePath =
      toolName === FILE_READ_TOOL_NAME
        ? toolArgs["file_path"]
        : toolArgs["filename"];

    if (typeof originalFilePath !== "string" || originalFilePath.length === 0) {
      console.log("文件路径不能为空");
      return new ToolMessage({
        content: "文件路径不能为空",
        tool_call_id: request.toolCall.id ?? "",
        status: "error",
      });
    }

    const resolvedFilePath = resolveToolFilePath(
      originalFilePath,
      workspacePath,
    );

    if (!resolvedFilePath) {
      const errorMessage = `非法的路径：${originalFilePath}（路径超出工作空间范围）`;
      console.log(errorMessage);
      return new ToolMessage({
        content: errorMessage,
        tool_call_id: request.toolCall.id ?? "",
        status: "error",
      });
    }

    if (toolName === FILE_READ_TOOL_NAME) {
      toolArgs["file_path"] = resolvedFilePath;
    } else {
      toolArgs["filename"] = resolvedFilePath;
      toolArgs["directory"] = "";
    }

    console.log(`校验后的工具输入: ${JSON.stringify(toolArgs)}`);

    try {
      return handler({
        ...request,
        toolCall: {
          ...request.toolCall,
          args: toolArgs,
        },
      });
    } catch (e) {
      console.log(`Tool failed: ${e}`);
      throw e;
    }
  },
});
const agent = createAgent({
  model: llm,
  systemPrompt: systemPromot,
  tools: [fileReadTool, fileWriterTool],
  middleware: [fileReadAndWriteMiddleware],
});

const userInput1 =
  "帮我创建一个周一到周五每天早上9点的任务，查询阿里港股的股价信息，以及一周内阿里相关的最新资讯，发送到我的qq。";
const userInput2 = "查一下我现在的定时任务";
const userInput3 = "帮我把查询阿里股价的任务改到9点半";

async function runTurn(userInput: string) {
  console.log(`\n===== 用户输入 =====\n${userInput}\n`);

  const stream = await agent.stream(
    {
      messages: [
        {
          role: "user",
          content: createTaskMessage(userInput),
        },
      ],
    },
    { streamMode: "values" },
  );

  let finalContent = "";

  for await (const chunk of stream) {
    const lastMessage = chunk.messages.at(-1);
    if (!lastMessage) {
      continue;
    }

    if (lastMessage.getType() === "tool") {
      console.log(lastMessage.content);
      continue;
    }

    if (lastMessage.getType() === "ai") {
      finalContent = String(lastMessage.content);
    }
  }

  console.log(`\n===== Agent 回复 =====\n${finalContent}\n`);
}

await runTurn(userInput1);
await runTurn(userInput2);
await runTurn(userInput3);
