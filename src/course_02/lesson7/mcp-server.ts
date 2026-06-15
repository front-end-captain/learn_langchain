import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
// import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { type Transport } from "@modelcontextprotocol/sdk/shared/transport";
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";

const app = express();
app.use(express.json());

function logRequest(method: string, detail: string) {
  console.log(`[MCP][${method}] ${detail}`);
}

function logError(method: string, detail: string, error: unknown) {
  console.error(`[MCP][${method}][ERROR] ${detail}`, error);
}

function createMcpServer() {
  const server = new Server(
    {
      name: "weather-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_weather",
          description: "Get weather for location",
          inputSchema: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "Location to get weather for",
              },
            },
            required: ["location"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    logRequest(
      "TOOL",
      `name=${request.params.name} arguments=${JSON.stringify(request.params.arguments ?? {})}`,
    );

    switch (request.params.name) {
      case "get_weather": {
        const { location } = request.params.arguments as { location: string };
        const resp = await fetch(
          `https://uapis.cn/api/v1/misc/weather?city=${encodeURIComponent(location)}`,
        );
        const data = (await resp.json()) as {
          province: string;
          city: string;
          weather: string;
          temperature: number;
          wind_direction: string;
          wind_power: string;
          humidity: number;
          report_time: string;
        };
        return {
          content: [
            {
              type: "text",
              text: `${location} 当前天气: ${data.weather}, 气温: ${data.temperature}摄氏度, ${data.wind_direction}${data.wind_power}, 相对湿度: ${data.humidity}, 报告时间: ${data.report_time}`,
            },
          ],
        };
      }
      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  });

  return server;
}

type SessionEntry = {
  server: Server;
  transport: StreamableHTTPServerTransport;
};

const sessions: Record<string, SessionEntry> = {};

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const initialize = isInitializeRequest(req.body);

  logRequest(
    "POST",
    `path=/mcp session=${sessionId ?? "none"} initialize=${String(initialize)}`,
  );

  try {
    if (sessionId) {
      const session = sessions[sessionId];
      if (!session) {
        logRequest("POST", `path=/mcp session=${sessionId} missing-session`);
        res.status(400).json({ error: "Invalid or missing session ID" });
        return;
      }

      logRequest(
        "POST",
        `path=/mcp session=${sessionId} reuse-existing-session`,
      );
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!initialize) {
      logRequest("POST", "path=/mcp rejected-non-initialize-without-session");
      res.status(400).json({ error: "Invalid initialization request" });
      return;
    }

    const server = createMcpServer();
    let transport: StreamableHTTPServerTransport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        sessions[newSessionId] = { server, transport };
        logRequest(
          "SESSION",
          `session=${newSessionId} initialized activeSessions=${Object.keys(sessions).length}`,
        );
      },
    });

    transport.onclose = () => {
      const activeSessionId = transport.sessionId;
      if (activeSessionId) {
        delete sessions[activeSessionId];
        logRequest(
          "CLOSE",
          `session=${activeSessionId} removed activeSessions=${Object.keys(sessions).length}`,
        );
      } else {
        logRequest("CLOSE", "session=unknown removed-without-session-id");
      }
    };

    logRequest("POST", "path=/mcp creating-new-session");
    // SDK 的 StreamableHTTPServerTransport 声明在 exactOptionalPropertyTypes 下
    // 与 Server.connect() 期望的 Transport 类型不完全兼容，这里做一次窄化。
    await server.connect(transport as Transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logError(
      "POST",
      `path=/mcp session=${sessionId ?? "none"} initialize=${String(initialize)}`,
      error,
    );
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  logRequest("GET", `path=/mcp session=${sessionId ?? "none"}`);

  if (!sessionId) {
    logRequest("GET", "path=/mcp missing-session-id");
    res.status(400).send("Missing session ID");
    return;
  }

  const session = sessions[sessionId];
  if (!session) {
    logRequest("GET", `path=/mcp session=${sessionId} invalid-session`);
    res.status(400).send("Invalid session ID");
    return;
  }

  try {
    logRequest("GET", `path=/mcp session=${sessionId} open-sse-stream`);
    await session.transport.handleRequest(req, res);
  } catch (error) {
    logError("GET", `path=/mcp session=${sessionId}`, error);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
    }
  }
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  logRequest("DELETE", `path=/mcp session=${sessionId ?? "none"}`);

  if (!sessionId) {
    logRequest("DELETE", "path=/mcp missing-session-id");
    res.status(400).send("Missing session ID");
    return;
  }

  const session = sessions[sessionId];
  if (!session) {
    logRequest("DELETE", `path=/mcp session=${sessionId} invalid-session`);
    res.status(400).send("Invalid session ID");
    return;
  }

  try {
    logRequest(
      "DELETE",
      `path=/mcp session=${sessionId} terminate-requested-by-client`,
    );
    await session.transport.handleRequest(req, res);
  } catch (error) {
    logError("DELETE", `path=/mcp session=${sessionId}`, error);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
    }
  }
});

app.listen(3000, () => {
  console.log("Weather MCP Streamable HTTP server running on port 3000");
  console.log("[MCP][START] endpoints=POST,GET,DELETE /mcp");
});
