import path from "node:path";
import url from "node:url";
import {
  createAgent,
  createMiddleware,
  HumanMessage,
  type BaseMessage,
} from "langchain";

import { build_bootstrap_prompt } from "./util";
import {
  append_session_raw,
  baseMessagesToSessionMessages,
  formatMessagesForSummary,
  load_session_ctx,
  maybeCompressMessages,
  messageContentToText,
  pruneToolResults,
  save_session_ctx,
  sessionMessageToBaseMessage,
  SUMMARY_PROMPT,
} from "./message-context";
import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model";
import { baiduSearchTool } from "../../tools/baidu-search-tool";
import { scrapeWebsiteTool } from "../../tools/scrape-website-tool";
import { fileWriterTool } from "../../tools/file-writer-tool";
import { fileReadTool } from "../../tools/file-read-tool";
import { createFixedDirectoryReadTool } from "../../tools/fixed-directory-read-tool";

import {
  createAgentUpdateEvent,
  createToolCallsEvent,
  getToolCalls,
  normalizeAgentStreamEventForLog,
} from "../../helper/agent-stream";
import { createAgentRunFileLogger } from "../../helper/file-logger";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDir = path.join(__dirname, "logs");

export const WORKSPACE_DIR = path.resolve(__dirname, "workspace");
export const SESSIONS_DIR = path.resolve(WORKSPACE_DIR, "sessions");

export const SESSION_ID = "demo";
export const PRUNE_KEEP_TURNS = 10;
export const COMPRESS_THRESHOLD = 0.45;
export const CHUNK_TOKENS = 2000;
export const FRESH_KEEP_TURNS = 10;
export const MODEL_CTX_LIMIT = 32000;

export const DEMO_ROUNDS = [
  {
    label: "调研任务",
    message:
      "帮我调研极客时间平台上多智能体相关课程的现状，生成一份调研报告保存到文件",
  },
  {
    label: "结论提炼",
    message: "把刚才报告里的关键结论总结成3条，方便我发给同事",
  },
  {
    label: "周报生成",
    message: "帮我写本周工作总结，从记忆文件里读本周做了什么，保存到文件",
  },
];

function createModel() {
  return new AliyunQwenChatModel({
    model: process.env["QWEN_MODEL"] ?? "",
    apiKey: process.env["QWEN_API_KEY"] ?? "",
    apiBase: process.env["QWEN_API_BASE"] ?? "",
  });
}

function createSummaryModel() {
  return new AliyunQwenChatModel({
    model: process.env["QWEN_SUMMARY_MODEL"] ?? "qwen3-turbo",
    apiKey: process.env["QWEN_API_KEY"] ?? "",
    apiBase: process.env["QWEN_API_BASE"] ?? "",
  });
}

class XiaoPaw {
  public session_id: string;
  public user_message: string;
  public _session_loaded: boolean; // session 恢复只做一次（首次 LLM 调用前）
  public _last_msgs: BaseMessage[]; // 保存 executor 的 messages 引用，kickoff 后用于持久化
  public _history_len: number; // 恢复的历史消息数，kickoff 后据此确定本轮新增消息

  constructor(session_id: string, user_message: string) {
    this.session_id = session_id;
    this.user_message = user_message;
    this._session_loaded = false;
    this._last_msgs = [];
    this._history_len = 0;
  }

  private async summarizeChunk(messages: BaseMessage[]): Promise<string> {
    const history = formatMessagesForSummary(messages);
    const response = await createSummaryModel().invoke([
      new HumanMessage(SUMMARY_PROMPT.replace("{history}", history)),
    ]);
    return messageContentToText(response.content);
  }

  private assistant_agent() {
    const systemPrompt = `
你是: XiaoPaw 个人助手
你的目标: 帮助晓寒高效完成各类任务，严谨、结果导向
你的背景:
${build_bootstrap_prompt(WORKSPACE_DIR)}
`;

    return createAgent({
      model: createModel(),
      tools: [
        baiduSearchTool,
        scrapeWebsiteTool,
        fileReadTool,
        fileWriterTool,
        createFixedDirectoryReadTool(WORKSPACE_DIR),
      ],
      systemPrompt,
      middleware: [
        createMiddleware<undefined>({
          name: "contextManage",
          beforeModel: async (state) => {
            let messages = [...state.messages];

            if (!this._session_loaded) {
              const history = load_session_ctx(this.session_id, SESSIONS_DIR);
              this._history_len = history.length;

              if (history.length > 0) {
                const currentUserMessage = [...messages]
                  .reverse()
                  .find((message) => HumanMessage.isInstance(message));

                messages = [
                  ...history.map(sessionMessageToBaseMessage),
                  ...(currentUserMessage ? [currentUserMessage] : []),
                ];
              }

              this._session_loaded = true;
            }

            messages = pruneToolResults(messages, PRUNE_KEEP_TURNS);
            messages = await maybeCompressMessages(messages, {
              freshKeepTurns: FRESH_KEEP_TURNS,
              chunkTokens: CHUNK_TOKENS,
              compressThreshold: COMPRESS_THRESHOLD,
              modelContextLimit: MODEL_CTX_LIMIT,
              summarizeChunk: (chunk) => this.summarizeChunk(chunk),
            });

            const currentUserMessageIndex = messages.findLastIndex((message) =>
              HumanMessage.isInstance(message),
            );
            if (currentUserMessageIndex >= 0) {
              this._history_len = currentUserMessageIndex;
            }

            this._last_msgs = messages;
            return { messages };
          },
          afterAgent: (state) => {
            this._last_msgs = [...state.messages];

            const allMessages = baseMessagesToSessionMessages(this._last_msgs);
            const newMessages = allMessages.slice(this._history_len);
            append_session_raw(this.session_id, newMessages, SESSIONS_DIR);
            save_session_ctx(this.session_id, allMessages, SESSIONS_DIR);

            return;
          },
        }),
      ],
    });
  }

  public async execute_task(onEvent: (e: Record<string, unknown>) => void) {
    const agent = this.assistant_agent();
    onEvent({
      type: "agent_update",
      messageType: "system",
      content: agent.options.systemPrompt,
    });

    const stream = await agent.streamEvents(
      {
        messages: [
          new HumanMessage(`${this.user_message} 针对用户请求的完整回复`),
        ],
      },
      { version: "v3" },
    );

    for await (const chunk of stream.values) {
      const lastMessage = chunk.messages.at(-1);
      onEvent(
        normalizeAgentStreamEventForLog(createAgentUpdateEvent(lastMessage)),
      );

      const toolCalls = getToolCalls(lastMessage);
      if (toolCalls.length > 0) {
        onEvent(
          normalizeAgentStreamEventForLog(createToolCallsEvent(toolCalls)),
        );
      }
    }

    return stream.output;
  }
}

export async function main() {
  const fileLogger = createAgentRunFileLogger({
    logDir: logDir,
    runName: `lesson10_${SESSION_ID}`,
    format: "pretty",
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log("XiaoPaw 助手 - 第19课：上下文生命周期管理");
  console.log("=".repeat(60));
  console.log(`Session ID : ${SESSION_ID}`);

  const saved = load_session_ctx(SESSION_ID, SESSIONS_DIR);
  if (saved.length > 0) {
    console.log(`历史消息   : ${saved.length} 条（将恢复上下文）`);
  } else {
    console.log("历史消息   : 无（全新 session）");
  }

  for (const [index, { label, message }] of DEMO_ROUNDS.entries()) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Round ${index + 1}/${DEMO_ROUNDS.length}  [${label}]`);
    console.log(`用户消息   : ${message}`);
    console.log(`${"─".repeat(60)}\n`);

    const xiaopaw = new XiaoPaw(SESSION_ID, message);
    const result = await xiaopaw.execute_task((e) => {
      console.error(JSON.stringify(e, null, 2));
      fileLogger.writeEvent(e);
    });
    console.info('回复: ', result.messages.at(-1)?.content);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("Session 文件：");
  console.log(
    `  ctx  → ${path.resolve(SESSIONS_DIR, `${SESSION_ID}_ctx.json`)}`,
  );
  console.log(
    `  raw  → ${path.resolve(SESSIONS_DIR, `${SESSION_ID}_raw.jsonl`)}`,
  );
  console.log("=".repeat(60));
}

if (import.meta.main) {
  main();
}
