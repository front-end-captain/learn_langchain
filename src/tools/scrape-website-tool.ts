import { tool } from "@langchain/core/tools";
import * as z from "zod";

export const SCRAPE_WEBSITE_TOOL_NAME = "Read website content";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.google.com/",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

type ScrapeWebsiteFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

type ScrapeWebsiteInput = {
  website_url?: string | undefined;
};

export type ScrapeWebsiteToolOptions = {
  websiteUrl?: string;
  cookies?: Record<string, string | undefined>;
  fetchFn?: ScrapeWebsiteFetch;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function createWebsiteUrlSchema(defaultWebsiteUrl?: string) {
  const description = defaultWebsiteUrl
    ? `Optional website url to scrape. Defaults to ${defaultWebsiteUrl}.`
    : "Mandatory website url to scrape.";

  const schema = z
    .string()
    .trim()
    .min(1, "website_url 不能为空。")
    .url("website_url 必须是有效的 URL。")
    .refine(isHttpUrl, "website_url 仅支持 http 或 https URL。")
    .describe(description);

  return defaultWebsiteUrl
    ? z.preprocess(
        (value) => (value === "" || value === null ? undefined : value),
        schema.optional(),
      )
    : schema;
}

export function createScrapeWebsiteToolSchema(defaultWebsiteUrl?: string) {
  return z.object({
    website_url: createWebsiteUrlSchema(defaultWebsiteUrl),
  });
}

function buildCookieHeader(
  cookies: Record<string, string | undefined> | undefined,
): string | undefined {
  const cookiePairs = Object.entries(cookies ?? {})
    .filter(([, value]) => value !== undefined && value.trim().length > 0)
    .map(([name, value]) => `${name}=${value ?? ""}`);

  return cookiePairs.length > 0 ? cookiePairs.join("; ") : undefined;
}

function buildHeaders(options: ScrapeWebsiteToolOptions): Headers {
  const headers = new Headers({
    ...DEFAULT_HEADERS,
    ...(options.headers ?? {}),
  });
  const cookieHeader = buildCookieHeader(options.cookies);

  if (cookieHeader && !headers.has("Cookie")) {
    headers.set("Cookie", cookieHeader);
  }

  return headers;
}

function decodeHtmlEntity(entity: string): string {
  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    const codePoint = Number.parseInt(entity.slice(2), 16);
    return Number.isFinite(codePoint)
      ? String.fromCodePoint(codePoint)
      : `&${entity};`;
  }

  if (entity.startsWith("#")) {
    const codePoint = Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(codePoint)
      ? String.fromCodePoint(codePoint)
      : `&${entity};`;
  }

  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return namedEntities[entity] ?? `&${entity};`;
}

export function extractWebsiteText(html: string): string {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(
      /<\/(address|article|aside|blockquote|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&([a-zA-Z][a-zA-Z0-9]+|#\d+|#x[0-9a-fA-F]+);/g, (_match, entity: string) =>
      decodeHtmlEntity(entity),
    )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function executeScrapeWebsite(
  input: ScrapeWebsiteInput,
  options: ScrapeWebsiteToolOptions,
): Promise<string> {
  const websiteUrl = input.website_url ?? options.websiteUrl;

  if (!websiteUrl) {
    return [
      "错误：缺少网站 URL。",
      "原因：未提供 website_url，且工具创建时也没有设置默认 websiteUrl。",
      "解决提示：请传入 website_url，或通过 createScrapeWebsiteTool({ websiteUrl }) 设置默认地址。",
    ].join("\n");
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchFn = options.fetchFn ?? fetch;

  try {
    const response = await fetchFn(websiteUrl, {
      method: "GET",
      headers: buildHeaders(options),
      signal: controller.signal,
    });

    if (!response.ok) {
      return [
        "错误：HTTP请求错误。",
        `原因：读取网页失败，状态码 ${response.status}，状态信息：${response.statusText || "未知"}。`,
        "解决提示：请确认 URL 可公开访问，或稍后重试。",
      ].join("\n");
    }

    let html: string;
    try {
      html = await response.text();
    } catch (error) {
      return [
        "错误：响应读取错误。",
        `原因：无法读取网页响应正文，错误详情：${error instanceof Error ? error.message : String(error)}。`,
        "解决提示：请确认目标站点返回的是可读取的文本内容。",
      ].join("\n");
    }

    const content = extractWebsiteText(html);

    if (!content) {
      return [
        "错误：未提取到网页文本。",
        "原因：目标页面可能为空、主要内容由 JavaScript 动态渲染，或返回的不是 HTML/文本内容。",
        "解决提示：请尝试其它 URL，或使用支持浏览器渲染的工具读取动态页面。",
      ].join("\n");
    }

    return `The following text is scraped website content:\n\n${content}`;
  } catch (error) {
    if (isAbortError(error)) {
      return [
        "错误：请求超时。",
        `原因：目标网站响应时间超过 ${Math.round(timeoutMs / 1000)} 秒。`,
        "解决提示：请稍后重试，或提高 timeoutMs。",
      ].join("\n");
    }

    return [
      "错误：网络请求异常。",
      `原因：读取网页时发生异常，错误类型：${error instanceof Error ? error.name : typeof error}，错误详情：${error instanceof Error ? error.message : String(error)}。`,
      "解决提示：请检查网络连通性、URL 是否正确，以及目标站点是否限制访问。",
    ].join("\n");
  } finally {
    clearTimeout(timeout);
  }
}

export function createScrapeWebsiteTool(
  options: ScrapeWebsiteToolOptions = {},
) {
  const schema = createScrapeWebsiteToolSchema(options.websiteUrl);

  return tool((input) => executeScrapeWebsite(input, options), {
    name: SCRAPE_WEBSITE_TOOL_NAME,
    description: options.websiteUrl
      ? `A tool that can be used to read ${options.websiteUrl}'s content.`
      : "A tool that can be used to read a website content.",
    schema,
  });
}

export const scrapeWebsiteToolSchema = createScrapeWebsiteToolSchema();
export const scrapeWebsiteTool = createScrapeWebsiteTool();
