/**
 从‘面向过程的程序员’ -> '面向组件的管理者'

 定义一个 agent 的三个维度：
 - 角色（role） 大模型拥有海量的知识，设定角色的目的是唤醒并锁定其在特定领域内的专业认知，在后续推理和内容生成时，自发调用与角色匹配的专业词汇、分析框架和行为黑话
 - 目标（goal） 决定 agent 在面临选择时的价值导向，是一种宏观的偏好设定
 - 背景（backstory）设定 agent 的处事风格、工作流心法和能力边界，告诉 agent 面对不同情况时应该采取的思考模式和原则
*/

import { createAgent } from "langchain";
import { AliyunQwenChatModel } from "../llm/aliyun-qwen-chat-model";
import { saveIntermediateProductTool } from "../tools/intermediate-tool";

/**
 * CrewAI 到 LangChain 的核心概念映射：
 *
 * 1. CrewAI Agent(role, goal, backstory, tools, llm)
 *    在 LangChain 中不是一个同名构造器，而是：
 *    createAgent({ model, tools, systemPrompt })。
 *
 * 2. CrewAI 的 role / goal / backstory
 *    本质都是“约束模型行为的系统级上下文”，所以在 LangChain 中合并成 systemPrompt。
 *
 * 3. CrewAI 的 kickoff(messages)
 *    对应 LangChain Agent 的 invoke({ messages })。
 *
 * 4. CrewAI 的 allow_delegation=False
 *    LangChain 当前示例里没有显式 delegation 开关，因此要写进 prompt：不允许委派给其他 Agent。
 *
 * 5. CrewAI 的 verbose=True
 *    LangChain 没有完全等价的同名参数；本示例用 console.log 输出最终消息。
 *    后续如果要看完整执行过程，可以改用 stream 或 callbacks。
 */
const contentStrategistSystemPrompt = `
你是：资深小红书增长策略专家。

你的目标：
基于 CES 互动评分算法，为产品制定一套能穿透"L1 冷启动池"并具有长尾搜索价值的内容策略。

你的背景：
你曾是国内顶级 MCN 机构的内容总监，深谙小红书 2025 年的算法变迁。
你不再相信简单的流量铺张，而是坚信"价值耕耘"和"KFS 闭环"。

**核心理论储备**：
- CES 评分机制：关注 8 分 > 评论 4 分 > 收藏 1 分 > 点赞 1 分，优先考虑"如何骗评论"和"如何骗收藏"
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

// 对应 Python 版本中的 AliyunLLM(...)
// Bun 会自动加载 .env，因此这里可以直接读取 QWEN_API_KEY / QWEN_API_BASE。
const llm = new AliyunQwenChatModel({
  model: "qwen3.7-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

// 对应 Python 版本中的 Agent(...)
const contentStrategist = createAgent({
  model: llm,
  tools: [saveIntermediateProductTool],
  systemPrompt: contentStrategistSystemPrompt,
});

// 对应 Python 版本中的 content_strategist.kickoff([...])
const stream = await contentStrategist.stream(
  {
    messages: [
      {
        role: "user",
        content: "我今天健身了，感觉很开心，帮我设计一篇笔记",
      },
    ],
  },
  {
    streamMode: "values",
  },
);

for await (const chunk of stream) {
  const lastMessage = chunk.messages.at(-1);

  console.log("\n==============================");
  console.log("最新消息类型:", lastMessage?.getType?.());
  console.log("最新消息内容:", lastMessage?.content);

  if ("tool_calls" in (lastMessage ?? {})) {
    // @ts-ignore
    console.log("工具调用:", lastMessage?.tool_calls);
  }
}
