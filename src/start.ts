import { createAgent, AIMessage, HumanMessage, ToolMessage } from "langchain";
import { tool } from "@langchain/core/tools";
import * as z from "zod";
import { AliyunQwenChatModel } from "./llm/aliyun-qwen-chat-model";

const getWeather = tool((input) => `It's always sunny in ${input.city}!`, {
  name: "get_weather",
  description: "Get the weather for a given city",
  schema: z.object({
    city: z.string().describe("The city to get the weather for"),
  }),
});

const model = new AliyunQwenChatModel({
  model: "qwen3.7-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

const agent = createAgent({
  model,
  tools: [getWeather],
});

const stream = await agent.stream(
  {
    messages: [{ role: "user", content: "今天北京的天气怎么样?" }],
  },
  { streamMode: "values" },
);

for await (const chunk of stream) {
  // console.info("\nmessages", chunk.messages);

  const lastMessage = chunk.messages.at(-1);

  if (lastMessage instanceof HumanMessage) {
    console.info(
      lastMessage.getType().toUpperCase() + ": \n" + lastMessage.content + "\n",
    );
  }

  if (lastMessage instanceof ToolMessage) {
    console.info(
      lastMessage.getType().toUpperCase() + ": \n" + lastMessage.content + "\n",
    );
  }

  if (lastMessage instanceof AIMessage) {
    console.info(
      lastMessage.getType().toUpperCase() + ": \n" + lastMessage.content + "\n",
    );
    if (
      Array.isArray(lastMessage.tool_calls) &&
      lastMessage.tool_calls.length
    ) {
      console.info(
        "ToolCall: ",
        lastMessage.tool_calls?.map((t) => t.name).join(","),
        "\n",
      );
    }
  }
}
