import { tool, DynamicStructuredTool } from "@langchain/core/tools";
import {
  SystemMessage,
  AIMessage,
  ToolMessage,
  HumanMessage,
} from "@langchain/core/messages";
import * as z from "zod";
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  ReducedValue,
  type GraphNode,
  type ConditionalEdgeRouter,
  START,
  END,
} from "@langchain/langgraph";

import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model";
import {
  createAgentUpdateEvent,
  createToolCallsEvent,
  getToolCalls,
  type AgentStreamEventHandler,
} from "../../helper/agent-stream";

// Step1: define model
const model = new AliyunQwenChatModel({
  model: process.env["QWEN_MODEL"] ?? "",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

// Step2: Define tools
const schema = z.object({
  a: z.coerce.number().describe("First number"),
  b: z.coerce.number().describe("Second number"),
});
const add = tool(({ a, b }) => a + b, {
  name: "add",
  description: "Add two numbers",
  schema,
});
const multiply = tool(({ a, b }) => a * b, {
  name: "multiply",
  description: "Multiply two numbers",
  schema,
});
const divide = tool(({ a, b }) => a / b, {
  name: "divide",
  description: "Divide two numbers",
  schema,
});

// Augment the LLM with tools
const toolsByName: Record<string, DynamicStructuredTool> = {
  [add.name]: add,
  [multiply.name]: multiply,
  [divide.name]: divide,
};
const tools = Object.values(toolsByName);
const modelWithTools = model.bindTools(tools);

// Step3: Define state
const MessagesState = new StateSchema({
  messages: MessagesValue,
  llmCalls: new ReducedValue(z.number().default(0), {
    reducer: (x, y) => x + y,
  }),
});

// Step4: Define model node
const llmCall: GraphNode<typeof MessagesState> = async (state) => {
  const msg = await modelWithTools.invoke([
    new SystemMessage(
      "You are a helpful assistant tasked with performing arithmetic on a set of inputs.",
    ),
    ...state.messages,
  ]);
  return {
    messages: [msg],
    llmCalls: 1,
  };
};

// Step5: Define tool node
const toolNode: GraphNode<typeof MessagesState> = async (state) => {
  const lastMsg = state.messages.at(-1);
  if (lastMsg == null || !AIMessage.isInstance(lastMsg)) {
    return { messages: [] };
  }
  const result: ToolMessage[] = [];
  for (const toolcall of lastMsg.tool_calls ?? []) {
    const tool = toolsByName[toolcall.name];
    const observation = (await tool?.invoke?.(toolcall)) as ToolMessage;
    result.push(observation);
  }
  return { messages: result };
};

// Step6: Define logic to determine whether to end
const shouldContinue: ConditionalEdgeRouter<typeof MessagesState> = (state) => {
  const lastMsg = state.messages.at(-1);
  if (!lastMsg || !AIMessage.isInstance(lastMsg)) {
    return END;
  }
  if (lastMsg.tool_calls?.length) {
    return "toolNode";
  }

  return END;
};

export async function run(input: string, onEvent?: AgentStreamEventHandler) {
  let finalContent: string | undefined;
  let finalMessageType: string | undefined;

  /**
START
  ↓
llmCall
  ↓
shouldContinue 判断
  ├─ 如果有 tool_calls →  toolNode →  llmCall
  └─ 如果没有 tool_calls →  END
*/
  const agent = new StateGraph(MessagesState)
    .addNode("llmCall", llmCall) // 添加节点
    .addNode("toolNode", toolNode) // 添加节点
    .addEdge(START, "llmCall") // 设置起点路径
    .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END]) // 设置条件路径
    .addEdge("toolNode", "llmCall") // 设置路径
    .compile();

  const stream = await agent.streamEvents(
    {
      messages: [new HumanMessage("Add 3 and 4")],
    },
    { version: "v3" },
  );

  for await (const chunk of stream.values) {
    const lastMessage = chunk.messages.at(-1);
    finalContent = lastMessage?.content as string;
    finalMessageType = lastMessage?.type;

    onEvent?.(createAgentUpdateEvent(lastMessage));

    const toolCalls = getToolCalls(lastMessage);
    if (toolCalls.length > 0) {
      onEvent?.(createToolCallsEvent(toolCalls));
    }
  }
  return { type: finalMessageType, message: finalContent };
}
