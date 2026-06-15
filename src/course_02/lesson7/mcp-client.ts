import { loadMcpTools } from "@langchain/mcp-adapters";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type Transport } from "@modelcontextprotocol/sdk/shared/transport";
import { createAgent } from "langchain";
import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model";

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp"),
);
const client = new Client({
  name: "weather-client",
  version: "0.1.0",
});

try {
  // SDK 的 StreamableHTTPClientTransport 在 exactOptionalPropertyTypes 下
  // 与 Client.connect() 期望的 Transport 类型不完全兼容，这里做一次窄化。
  await client.connect(transport as Transport);
  const tools = await loadMcpTools("weather", client);

  const llm = new AliyunQwenChatModel({
    model: "qwen3.7-plus",
    apiKey: process.env["QWEN_API_KEY"] ?? "",
    apiBase: process.env["QWEN_API_BASE"] ?? "",
  });
  const agent = createAgent({
    model: llm,
    tools,
  });

  const weatherResponse = await agent.invoke({
    messages: [{ role: "user", content: "今天北京的天气怎么样?" }],
  });
  console.info("weatherResponse", weatherResponse);
} finally {
  try {
    await transport.terminateSession();
    console.info("[MCP][CLIENT] session terminated via DELETE /mcp");
  } finally {
    await client.close();
    console.info("[MCP][CLIENT] client closed");
  }
}
