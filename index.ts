// import { StringOutputParser } from "@langchain/core/output_parsers";
// import { ChatPromptTemplate } from "@langchain/core/prompts";
// import { FakeListChatModel } from "@langchain/core/utils/testing";
//
// const prompt = ChatPromptTemplate.fromMessages([
//   [
//     "system",
//     "你是一名耐心的 TypeScript 老师。回答要简洁，并优先解释第一性原理。",
//   ],
//   ["human", "请用三点说明 {topic} 如何帮助我完成：{goal}"],
// ]);
//
// const model = new FakeListChatModel({
//   responses: [
//     [
//       "1. LangChain 把模型、提示词、解析器和工具都抽象成可组合的 Runnable。",
//       "2. 你可以用 LCEL 把这些步骤像管道一样连接，形成可测试、可替换的链。",
//       "3. 真正接入大模型时，只需要把这里的 FakeListChatModel 换成 ChatOpenAI 等模型实现。",
//     ].join("\n"),
//   ],
// });
//
// const chain = prompt.pipe(model).pipe(new StringOutputParser());
//
// const answer = await chain.invoke({
//   topic: "LangChain Expression Language（LCEL）",
//   goal: "学习如何搭建一个最小 AI 应用",
// });
// console.log(answer);

import { tool, createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import * as z from "zod";

const getWeather = tool((input) => `It's always sunny in ${input.city}!`, {
  name: "get_weather",
  description: "Get the weather for a given city",
  schema: z.object({
    city: z.string().describe("The city to get the weather for"),
  }),
});

const model = new ChatOpenAI({
  model: "qwen3.7-plus",
  apiKey: process.env["QWEN_API_KEY"],
  configuration: {
    baseURL: process.env.QWEN_API_BASE,
    // logLevel: "debug",
  },
});

const agent = createAgent({
  model: model,
  tools: [getWeather],
});

const resp = await agent.invoke({
  messages: [{ role: "user", content: "今天北京的天气怎么样?" }],
});
console.log(resp.messages);

// const modelWithTools = model.bindTools([getWeather]);
// const resp = await modelWithTools.invoke("今天北京的天气怎么样?");
// console.log(resp);
