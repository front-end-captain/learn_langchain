import { createAgent } from "langchain";
import {
  createAgentUpdateEvent,
  createToolCallsEvent,
  getToolCalls,
  type AgentStreamEvent,
  type AgentStreamEventHandler,
} from "../../helper/agent-stream";
import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model";
import { saveIntermediateProductTool } from "../../tools/intermediate-tool";

export type Lesson1StreamEvent = AgentStreamEvent;

export type Lesson1Result = {
  finalContent: unknown;
  finalMessageType: string | undefined;
};

export const defaultLesson1Input =
  "我今天健身了，感觉很开心，帮我设计一篇笔记";

const contentStrategistSystemPrompt = `
你是：资深小红书增长策略专家。

你的目标：
基于 CES 互动评分算法，为产品制定一套能穿透"L1 冷启动池"并具有长尾搜索价值的内容策略。

你的背景：
你曾是国内顶级 MCN 机构的内容总监，深谙小红书 2025 年的算法变迁。
你不再相信简单的流量铺张，而是坚信"价值耕耘"和"KFS 闭环"。

**核心理论储备**：
- CES 评分机制：关注 8 分 > 评论 4 分 > 收藏 1 分 > 点赞 1 分，优先考虑如何提升评论和收藏
- 反漏斗模型 Anti-Funnel：坚持"窄即是宽"，先锁定最精准的核心人群，再寻求破圈
- 语义工程 SOP：爆款标题公式【痛点场景】+【解决方案 / 情绪钩子】+【群体标签】

**思维心法**：
1. 反漏斗定位：找到产品最"痛"的细分场景。例如：不是"喝水"，而是"独处时的精神避难所"
2. 设计钩子：互动钩子，引发争议或共鸣的问题；价值锚点，用干货点诱导收藏
3. 关键词布局：指定 3 个核心长尾词，为搜索流量复活做准备
4. 分步骤慢思考：你必须使用 Save_Intermediate_Product_Tool 工具保存中间结果

**行为边界**：
- 只负责输出策略大纲 Brief
- 绝对不要撰写最终正文
- 绝对不要撰写完整示例文案
- 不允许委派给其他 Agent
- 所有思考过程、工具调用和最终输出都必须使用中文

最终输出格式：
1. 核心人群定位
2. 反漏斗切入场景
3. CES 互动设计
4. 收藏价值设计
5. 3 个核心长尾关键词
6. 内容策略 Brief
`.trim();

export function createLesson1TaskMessage(input: string) {
  return input;
}

export function createContentStrategistAgent() {
  const llm = new AliyunQwenChatModel({
    model: "qwen3.7-plus",
    apiKey: process.env["QWEN_API_KEY"] ?? "",
    apiBase: process.env["QWEN_API_BASE"] ?? "",
  });

  return createAgent({
    model: llm,
    tools: [saveIntermediateProductTool],
    systemPrompt: contentStrategistSystemPrompt,
  });
}

export async function runLesson1WithStream(
  input: string,
  onEvent?: AgentStreamEventHandler,
): Promise<Lesson1Result> {
  const contentStrategist = createContentStrategistAgent();
  const stream = await contentStrategist.stream(
    {
      messages: [
        {
          role: "user",
          content: createLesson1TaskMessage(input),
        },
      ],
    },
    {
      streamMode: "values",
    },
  );

  let finalContent: unknown;
  let finalMessageType: string | undefined;

  for await (const chunk of stream) {
    const lastMessage = chunk.messages.at(-1);
    finalContent = lastMessage?.content;
    finalMessageType = lastMessage?.getType?.();

    onEvent?.(createAgentUpdateEvent(lastMessage));

    const toolCalls = getToolCalls(lastMessage);
    if (toolCalls.length > 0) {
      onEvent?.(createToolCallsEvent(toolCalls));
    }
  }

  return {
    finalContent,
    finalMessageType,
  };
}
