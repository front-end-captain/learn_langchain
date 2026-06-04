import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { AliyunQwenChatModel } from "./aliyun-qwen-chat-model";

// 创建阿里云通义千问 ChatModel 实例。
// Bun 会自动加载 .env，因此这里可以直接读取环境变量。
const llm = new AliyunQwenChatModel({
  model: "qwen3.7-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
  temperature: 0.7,
});

// 测试基本调用
const response = await llm.invoke("你好，请介绍一下你自己");
console.log("响应:", response.content);

// 测试多轮对话
const messages = [
  new SystemMessage("你是一个有用的助手。"),
  new HumanMessage("1+1等于几？"),
];
const multiTurnResponse = await llm.invoke(messages);
console.log("多轮对话响应:", multiTurnResponse.content);
