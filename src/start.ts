import { createAgent } from "langchain";
import { tool } from "@langchain/core/tools";
import {} from "@langchain/core/agents";
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
  temperature: 0.7,
});

const agent = createAgent({
  model,
  tools: [getWeather],
});

const resp = await agent.invoke({
  messages: [{ role: "user", content: "今天北京的天气怎么样?" }],
});
console.log(resp.messages);
