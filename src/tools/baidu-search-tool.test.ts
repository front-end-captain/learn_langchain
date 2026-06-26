import { describe, expect, it, mock } from "bun:test";
import {
  baiduSearchToolSchema,
  createBaiduSearchTool,
} from "./baidu-search-tool.ts";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("baiduSearchToolSchema", () => {
  it("converts top_k strings to integers", () => {
    const parsed = baiduSearchToolSchema.parse({
      query: " LangChain 最新版本 ",
      top_k: "5",
    });

    expect(parsed.query).toBe("LangChain 最新版本");
    expect(parsed.top_k).toBe(5);
  });

  it("rejects invalid top_k values", () => {
    expect(() =>
      baiduSearchToolSchema.parse({
        query: "LangChain",
        top_k: "abc",
      }),
    ).toThrow();
  });

  it("rejects more than 20 sites after trimming empty values", () => {
    expect(() =>
      baiduSearchToolSchema.parse({
        query: "LangChain",
        sites: [
          ...Array.from({ length: 21 }, (_, index) => `site${index}.com`),
          "",
        ],
      }),
    ).toThrow();
  });
});

describe("createBaiduSearchTool", () => {
  it("sends a Baidu search request and formats references", async () => {
    const fetchFn = mock(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://qianfan.baidubce.com/v2/ai_search/web_search");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        "X-Appbuilder-Authorization": "Bearer test-key",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(String(init.body))).toEqual({
        messages: [{ content: "LangChain 工具", role: "user" }],
        search_source: "baidu_search_v2",
        resource_type_filter: [{ type: "web", top_k: 5 }],
        search_recency_filter: "month",
        search_filter: { match: { site: ["docs.langchain.com"] } },
      });

      return jsonResponse({
        request_id: "request-1",
        references: [
          {
            id: 1,
            title: "LangChain Tools",
            url: "https://docs.langchain.com/tools",
            content: "工具文档摘要",
          },
        ],
      });
    });
    const searchTool = createBaiduSearchTool({
      apiKey: "test-key",
      fetchFn,
    });

    const result = await searchTool.invoke({
      query: "LangChain 工具",
      top_k: "5",
      recency_filter: "month",
      sites: [" docs.langchain.com "],
    });

    expect(result).toContain("找到 1 条搜索结果");
    expect(result).toContain("结果1: [ LangChain Tools ]");
    expect(result).toContain("https://docs.langchain.com/tools");
    expect(result).toContain("内容摘要: 工具文档摘要");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns a clear error when API key is missing without sending a request", async () => {
    const fetchFn = mock(async () => jsonResponse({ references: [] }));
    const searchTool = createBaiduSearchTool({
      apiKey: "",
      env: {},
      fetchFn,
    });

    const result = await searchTool.invoke({ query: "LangChain" });

    expect(result).toContain("缺少API认证密钥");
    expect(fetchFn).toHaveBeenCalledTimes(0);
  });

  it("returns a friendly API error", async () => {
    const fetchFn = mock(async () =>
      jsonResponse({
        code: "216003",
        message: "auth failed",
        request_id: "request-auth",
      }),
    );
    const searchTool = createBaiduSearchTool({
      apiKey: "bad-key",
      fetchFn,
    });

    const result = await searchTool.invoke({ query: "LangChain" });

    expect(result).toContain("API返回错误");
    expect(result).toContain("216003");
    expect(result).toContain("API Key 认证失败");
  });

  it("returns guidance when references are empty", async () => {
    const fetchFn = mock(async () => jsonResponse({ references: [] }));
    const searchTool = createBaiduSearchTool({
      apiKey: "test-key",
      fetchFn,
    });

    const result = await searchTool.invoke({ query: "非常具体的问题" });

    expect(result).toContain("未找到相关搜索结果");
    expect(result).toContain("非常具体的问题");
  });

  it("returns an HTTP error for non-2xx responses", async () => {
    const fetchFn = mock(async () =>
      jsonResponse(
        { message: "server error" },
        { status: 500, statusText: "Internal Server Error" },
      ),
    );
    const searchTool = createBaiduSearchTool({
      apiKey: "test-key",
      fetchFn,
    });

    const result = await searchTool.invoke({ query: "LangChain" });

    expect(result).toContain("HTTP请求错误");
    expect(result).toContain("500");
  });

  it("returns a JSON parse error for invalid JSON responses", async () => {
    const fetchFn = mock(
      async () =>
        new Response("not json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const searchTool = createBaiduSearchTool({
      apiKey: "test-key",
      fetchFn,
    });

    const result = await searchTool.invoke({ query: "LangChain" });

    expect(result).toContain("响应解析错误");
  });

  it("returns a network error when fetch fails", async () => {
    const fetchFn = mock(async () => {
      throw new Error("network down");
    });
    const searchTool = createBaiduSearchTool({
      apiKey: "test-key",
      fetchFn,
    });

    const result = await searchTool.invoke({ query: "LangChain" });

    expect(result).toContain("网络请求异常");
    expect(result).toContain("network down");
  });

  it("returns a timeout error when the request is aborted", async () => {
    const fetchFn = mock(
      async (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const searchTool = createBaiduSearchTool({
      apiKey: "test-key",
      fetchFn,
      timeoutMs: 1,
    });

    const result = await searchTool.invoke({ query: "LangChain" });

    expect(result).toContain("请求超时");
  });
});
