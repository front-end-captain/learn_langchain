import { createAgent, tool } from "langchain";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { z } from "zod";

import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model";
import { saveIntermediateProductTool } from "../../tools/intermediate-tool";
import {
  createAgentUpdateEvent,
  createStructuredResponseEvent,
  createToolCallsEvent,
  getToolCalls,
  type AgentStreamEventHandler,
} from "../../helper/agent-stream";

const llm = new AliyunQwenChatModel({
  model: "qwen3-max",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

const mcpClient = new MultiServerMCPClient({
  sandbox: {
    transport: "http",
    url: "http://localhost:8022/mcp",
  },
});

const sandboxTools = await mcpClient.getTools();

const sandboxAgent = createAgent({
  model: llm,
  tools: sandboxTools,
  systemPrompt: `
你是：万能沙盒工作助手
你的目标：利用沙盒的浏览器、文件系统、代码执行环境，尝试各种方式最终完成任务
你的背景：
你拥有熟练的python和js的编程技术，擅长使用各种工具和环境来完成任务。

你有如下专业知识：
你现在在国内，搜索引擎使用百度，搜索引擎使用方式为：https://www.baidu.com/s?wd=你的问题
你熟悉浏览器操作，可以使用浏览器来完成各种任务，不过因为你没有手机，通常没法用手机登录；浏览器有时执行很慢，你需要多等待；
你非常善于进行代码编辑，当遇到的问题需要代码解决时，你会使用代码编辑器来完成任务；如果遇到代码执行问题，你也会通过网络搜索查询解决；
当你需要一些数据和功能时，你也会尝试搜索对应的api接口或者sdk来完成任务；
你也可以用系统命令安装依赖库；
你很善用文件系统，你会自己记录中间结果，阅读之前的进度，查看代码或者浏览器生成的结果等，你相信好记性不如烂笔头；

当你收到任务时，你通常习惯按照以下思路完成任务：
1、你会先去理解任务，进行需求分析，当任务中有任何疑问，你会使用百度搜索来明确任务；
2、之后你会根据任务需求，基于你能使用的工具，设计一个大致的解决方案步骤列表，并通过写入沙盒文件的方式先进行记录；
3、之后你会按照步骤列表逐步执行，每完成一个步骤，你会将结果写入沙盒文件中记录；
4、当执行中发现偏离步骤列表，你会及时调整步骤列表，并继续执行；
5、当任务完成后，你会将最终结果返回给用户；
`,
});

// 把 sandboxAgent 包装成 assistantAgent 可调用的工具
const delegateToSandbox = tool(
  async ({ task, context }) => {
    console.info("sandboxAgent.invoke");
    const result = await sandboxAgent.invoke(
      {
        messages: [
          {
            role: "user",
            content: `任务：${task}\n\n上下文：${context}`,
          },
        ],
      },
      {
        recursionLimit: 100,
      },
    );

    return result.messages.at(-1)?.content ?? "";
  },
  {
    name: "delegate_to_sandbox",
    description:
      "将需要浏览器、代码执行、文件系统操作的任务委派给万能沙盒工作助手。",
    schema: z.object({
      task: z.string().describe("要委派给沙盒助手的任务"),
      context: z.string().describe("执行任务所需的背景信息和输出要求"),
    }),
  },
);

const KlineData = z
  .object({
    date: z.string().describe("日期，使用 YYYY-MM-DD 格式"),
    open: z.number().describe("开盘价"),
    high: z.number().describe("最高价"),
    low: z.number().describe("最低价"),
    close: z.number().describe("收盘价"),
    volume: z.number().int().describe("成交量，单位为股"),
  })
  .describe("单日 K 线数据结构，用于后续量化分析");

const LatestData = z
  .object({
    latest_price: z
      .number()
      .describe("最新股价，单位为港币，需对应早盘时点的最新成交价"),

    latest_volume: z
      .number()
      .int()
      .describe("当日最新成交量，单位为股，用于衡量当前交易活跃度"),

    latest_market_cap: z
      .number()
      .describe("最新市值，单位为港币，基于最新股价和总股本计算"),

    latest_pe_ratio: z
      .number()
      .describe("最新市盈率 PE，用于衡量当前估值相对盈利水平的高低"),

    last_30_days_klines: z
      .array(KlineData)
      .describe("最近30个交易日的日 K 线数据列表，用于后续量化分析"),
  })
  .describe("阿里巴巴港股最新的量化行情数据结构");

const AlibabaMorningReport = z
  .object({
    today: z
      .string()
      .describe("报告日期，使用 YYYY-MM-DD 格式，例如：2026-02-23"),

    latest_data: LatestData.describe(
      "基于最新行情和最近30日 K 线整理出的结构化量化数据，用于支撑后续分析结论",
    ),

    quantitative_analysis: z
      .string()
      .describe(
        "基于 latest_data 中的量化指标，如涨跌幅、波动率、成交量变化、市值和市盈率区间等，给出条理清晰的量化分析结论。需包含当前价格所处位置、短期趋势判断、风险/机会点，要求用专业、简明的中文表述，分段或分点说明",
      ),

    sentiment_analysis: z
      .string()
      .describe(
        "基于最近的新闻资讯、市场评论和舆情信息，总结对阿里巴巴的利好/利空因素，以及整体市场情绪，需给出主要新闻要点及其可能影响",
      ),

    final_report: z
      .string()
      .describe(
        "一封面向普通投资者的完整早盘报告正文，需以今天的日期开头，自然融合最新行情、量化分析结论和舆情解读，形成一个结构清晰、逻辑严谨、可直接发送的早报文本，使用正式、客观、中文口吻",
      ),
  })
  .describe("阿里巴巴港股早盘分析报告的最终交付物结构");

const assistantAgent = createAgent({
  model: llm,
  tools: [saveIntermediateProductTool, delegateToSandbox],
  responseFormat: AlibabaMorningReport,
  systemPrompt: `
你是个人万能助手总管。

你的职责：
1. 理解用户需求；
2. 拆解任务；
3. 保存中间分析；
4. 将需要浏览器、代码执行、搜索、文件系统的任务委派给万能沙盒工作助手；
5. 根据子任务结果整合最终答案。

行为边界：
你不能自己编造金融数据。
你必须完全基于子任务返回结果生成最终报告。
如果数据不足，需要重新委派任务获取。

你是：个人万能助手总管
你的目标：根据用户需求进行分析，拆解，分发任务，最终保证任务的完成
你的背景：
你是个人万能助手总管，善于接收用户的需求，拆解后分发给其它agent去完成。

你下属的agent包括：
- 万能沙盒工作助手：利用沙盒的浏览器、文件系统、代码执行环境，尝试各种方式最终完成任务。当你需要使用代码、浏览器、搜索时，都要委托给万能沙盒工作助手去完成。

你通常的工作思路包括：
1、你会先去理解用户需求，进行需求分析，将结果使用Save_Intermediate_Product_Tool记录；
2、之后你会规划步骤，生成子任务，使用Save_Intermediate_Product_Tool记录，每个子任务都要有明确的预期目标和足够的背景信息；
3、然后依次将子任务委托给其它agent，直到所有子任务完成。预期目标应该是结构化的json结果，你必须给子任务一个json schema，以便你整合和拼接最终结果；
4、根据每次的子任务结果，你会去管理当前的步骤，如果出现偏差你可以进行重新规划，同样使用Save_Intermediate_Product_Tool记录；
5、最终你会将最终结果返回给用户。

行为边界：
你不会直接执行任务，你会将任务拆解后分发给其它agent去完成。
你必须完全参照子任务的执行结果，不能自行编造，如果有疑问你需要重新分配任务去完成；

输出要求：
最终结果必须符合 AlibabaMorningReport 结构
`,
});

export async function run(today: string, onEvent?: AgentStreamEventHandler) {
  const stream = await assistantAgent.stream(
    {
      messages: [
        {
          role: "user",
          content: `
今天是 ${today}。你需要作为我的阿里巴巴港股“个人工作助理”，完成一个早盘报告里程碑任务：
1）基于沙盒可用的浏览器和代码执行能力，获取阿里巴巴港股（例如 9988.HK）的最新行情数据和最近 30 个交易日的 K 线数据(https://finance.yahoo.com 数据比较全)；重要：你的所有数据都必须是真实数据，要想法获取，实在不能获取宁可失败也不能编造
2）使用 Python 在沙盒中对这些数据进行量化分析（如价格区间、涨跌幅、成交量变化、市值和市盈率水平、K线形态、趋势线、支撑阻力位等），你的所有结论必须经过计算，不能编造
并据此形成清晰的量化分析结论；
3）通过浏览器检索阿里巴巴的最新新闻资讯和市场评论（在国内环境下优先使用百度搜索，例如：https://www.baidu.com/s?wd=阿里巴巴 港股 新闻），你的新闻必须附上来源且符合真实信息，不能自己加工
提炼对股价可能产生影响的关键信息并判断利好/利空及市场情绪；
4）在完成以上准备工作后，整合量化分析与舆情结论，撰写一封可以直接发送给投资者阅读的阿里巴巴港股早盘分析报告。
**期望输出**
严格符合 AlibabaMorningReport Pydantic 模型结构的 JSON 输出：
必须完整填充 today、latest_data、quantitative_analysis、sentiment_analysis、final_report 五个字段；
其中 latest_data 使用结构化数值数据，其余字段为中文自然语言描述。
`,
        },
      ],
    },
    {
      recursionLimit: 100,
      streamMode: "values",
    },
  );

  let message: string | undefined;
  let finalMessageType: string | undefined;

  for await (const chunk of stream) {
    const lastMessage = chunk.messages.at(-1);
    finalMessageType = lastMessage?.getType?.();

    onEvent?.(createAgentUpdateEvent(lastMessage));

    const toolCalls = getToolCalls(lastMessage);
    if (toolCalls.length > 0) {
      onEvent?.(createToolCallsEvent(toolCalls));
    }

    if (chunk.structuredResponse) {
      const report = AlibabaMorningReport.parse(chunk.structuredResponse);
      message = JSON.stringify(report, null, 2);
      onEvent?.(createStructuredResponseEvent(report));
    }
  }

  return { type: finalMessageType, message };
}
