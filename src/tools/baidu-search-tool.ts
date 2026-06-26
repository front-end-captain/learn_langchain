import { tool } from "@langchain/core/tools";
import * as z from "zod";

export const BAIDU_SEARCH_TOOL_NAME = "search_web";

// API 文档：https://cloud.baidu.com/doc/qianfan-api/s/Wmbq4z7e5
const BAIDU_SEARCH_ENDPOINT =
  "https://qianfan.baidubce.com/v2/ai_search/web_search";
const DEFAULT_TOP_K = 20;
const DEFAULT_TIMEOUT_MS = 30_000;

type BaiduSearchFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

type BaiduSearchToolOptions = {
  apiKey?: string;
  endpoint?: string;
  env?: Record<string, string | undefined>;
  fetchFn?: BaiduSearchFetch;
  timeoutMs?: number;
};

type BaiduSearchInput = z.infer<typeof baiduSearchToolSchema>;

type BaiduSearchReference = {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  content?: unknown;
};

type BaiduSearchApiResponse = {
  code?: unknown;
  message?: unknown;
  request_id?: unknown;
  requestId?: unknown;
  references?: unknown;
};

function parseTopK(value: unknown): unknown {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_TOP_K;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? value : parsed;
  }

  return value;
}

function normalizeSites(value: string[] | undefined): string[] | undefined {
  const sites = value?.map((site) => site.trim()).filter(Boolean);
  return sites && sites.length > 0 ? sites : undefined;
}

export const baiduSearchToolSchema = z.object({
  query: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, {
      message: "查询内容不能为空。",
    })
    .describe("搜索查询内容，即用户要搜索的问题或关键词。"),
  top_k: z
    .preprocess(
      parseTopK,
      z
        .number()
        .int()
        .min(0, "top_k 必须大于等于 0。")
        .max(50, "top_k 不能超过 50。"),
    )
    .default(DEFAULT_TOP_K)
    .describe("返回的搜索结果数量，默认 20，最大 50。"),
  recency_filter: z
    .preprocess(
      (value) => (value === null || value === "" ? undefined : value),
      z.enum(["week", "month", "semiyear", "year"]).optional(),
    )
    .describe("根据网页发布时间筛选：week/month/semiyear/year。"),
  sites: z
    .array(z.string())
    .optional()
    .superRefine((value, context) => {
      const sites = normalizeSites(value);
      if (sites && sites.length > 20) {
        context.addIssue({
          code: "custom",
          message: "站点列表最多支持 20 个站点。",
        });
      }
    })
    .transform(normalizeSites)
    .describe("指定搜索站点列表，最多 20 个站点。"),
});

function resolveApiKey(options: BaiduSearchToolOptions): string {
  return (
    options.apiKey ??
    options.env?.["BAIDU_API_KEY"] ??
    process.env["BAIDU_API_KEY"] ??
    ""
  ).trim();
}

function buildPayload(input: BaiduSearchInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    messages: [
      {
        content: input.query,
        role: "user",
      },
    ],
    search_source: "baidu_search_v2",
    resource_type_filter: [
      {
        type: "web",
        top_k: input.top_k,
      },
    ],
  };

  if (input.recency_filter) {
    payload["search_recency_filter"] = input.recency_filter;
  }

  if (input.sites) {
    payload["search_filter"] = {
      match: {
        site: input.sites,
      },
    };
  }

  return payload;
}

function stringifyUnknown(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return fallback;
}

function getErrorHint(errorCode: unknown): string {
  const descriptions: Record<string, string> = {
    "400": "请求参数错误，请检查输入参数格式和取值范围。",
    "500": "服务器内部错误，请稍后重试或尝试其它工具。",
    "501": "服务调用超时，请稍后重试或减少请求复杂度。",
    "502": "服务响应超时，请稍后重试或尝试其它工具。",
    "216003": "API Key 认证失败，请检查 API Key 是否正确、是否过期或是否有足够权限。",
  };

  return descriptions[String(errorCode)] ?? "请检查请求参数是否正确，或稍后重试。";
}

function isApiErrorCode(code: unknown): boolean {
  return code !== undefined && code !== null && code !== 0 && code !== "";
}

function formatReferences(references: BaiduSearchReference[]): string {
  const results = [`找到 ${references.length} 条搜索结果`, ""];

  for (const reference of references) {
    const id = stringifyUnknown(reference.id, "?");
    const title = stringifyUnknown(reference.title, "无标题");
    const url = stringifyUnknown(reference.url, "");
    const content = stringifyUnknown(reference.content, "");

    results.push(`结果${id}: [ ${title} ] ( ${url} )`);
    results.push(`  内容摘要: ${content}`);
    results.push("");
  }

  return results.join("\n");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function executeBaiduSearch(
  input: BaiduSearchInput,
  options: BaiduSearchToolOptions,
): Promise<string> {
  const apiKey = resolveApiKey(options);

  if (!apiKey) {
    return [
      "错误：缺少API认证密钥。",
      "原因：未提供百度千帆 AppBuilder API Key，环境变量 BAIDU_API_KEY 未设置。",
      "解决提示：请设置环境变量 BAIDU_API_KEY，或通过 createBaiduSearchTool({ apiKey }) 注入。",
    ].join("\n");
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchFn = options.fetchFn ?? fetch;

  try {
    const response = await fetchFn(options.endpoint ?? BAIDU_SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "X-Appbuilder-Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildPayload(input)),
      signal: controller.signal,
    });

    if (!response.ok) {
      return [
        "错误：HTTP请求错误。",
        `原因：HTTP请求失败，状态码 ${response.status}，状态信息：${response.statusText || "未知"}。`,
        "解决提示：请检查 API Key 是否有效，或稍后重试；反复出现请尝试其它工具。",
      ].join("\n");
    }

    let result: BaiduSearchApiResponse;
    try {
      result = (await response.json()) as BaiduSearchApiResponse;
    } catch (error) {
      return [
        "错误：响应解析错误。",
        `原因：服务器返回的响应不是有效的JSON格式，错误详情：${error instanceof Error ? error.message : String(error)}。`,
        "解决提示：可能是服务器临时故障，请稍后重试，或尝试其它工具。",
      ].join("\n");
    }

    if (isApiErrorCode(result.code)) {
      const requestId = stringifyUnknown(
        result.request_id ?? result.requestId,
        "未知",
      );
      const message = stringifyUnknown(result.message, "未知错误");

      return [
        "错误：API返回错误。",
        `原因：百度搜索API返回错误码 ${String(result.code)}，错误信息：${message}，请求ID：${requestId}。`,
        `解决提示：${getErrorHint(result.code)}`,
      ].join("\n");
    }

    const references = Array.isArray(result.references)
      ? (result.references as BaiduSearchReference[])
      : [];

    if (references.length === 0) {
      return [
        "错误：未找到相关搜索结果。",
        `原因：使用关键词「${input.query}」进行搜索，但未找到匹配结果，可能是关键词过于具体或过滤条件过于严格。`,
        "解决提示：尝试使用更通用的关键词，或放宽时间范围、站点限制等过滤条件。",
      ].join("\n");
    }

    return formatReferences(references);
  } catch (error) {
    if (isAbortError(error)) {
      return [
        "错误：请求超时。",
        `原因：服务器响应时间超过 ${Math.round(timeoutMs / 1000)} 秒，可能是网络延迟、服务器繁忙或请求处理时间过长。`,
        "解决提示：稍后重试搜索请求，或减少 top_k 加快响应。",
      ].join("\n");
    }

    return [
      "错误：网络请求异常。",
      `原因：网络请求过程中发生异常，错误类型：${error instanceof Error ? error.name : typeof error}，错误详情：${error instanceof Error ? error.message : String(error)}。`,
      "解决提示：请检查网络连通性后重试；反复出现请尝试其它工具。",
    ].join("\n");
  } finally {
    clearTimeout(timeout);
  }
}

export function createBaiduSearchTool(options: BaiduSearchToolOptions = {}) {
  return tool((input) => executeBaiduSearch(input, options), {
    name: BAIDU_SEARCH_TOOL_NAME,
    description: [
      "使用百度搜索引擎查找公开网络信息，可以按时间范围、指定站点等条件筛选搜索结果。",
      "返回标题、链接和内容摘要。",
      "适用于查找最新信息、新闻、价格、公司/人物动态、技术文档等需要联网搜索的场景。",
      "当已有更精确的内部知识库或专业工具时，优先使用那些工具。",
    ].join(""),
    schema: baiduSearchToolSchema,
  });
}

export const baiduSearchTool = createBaiduSearchTool();
