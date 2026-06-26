import { describe, expect, it, mock } from "bun:test";
import {
  createScrapeWebsiteTool,
  extractWebsiteText,
  scrapeWebsiteToolSchema,
} from "./scrape-website-tool.ts";

function htmlResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
    ...init,
  });
}

describe("scrapeWebsiteToolSchema", () => {
  it("trims and validates website_url", () => {
    const parsed = scrapeWebsiteToolSchema.parse({
      website_url: " https://example.com/page ",
    });

    expect(parsed.website_url).toBe("https://example.com/page");
  });

  it("rejects non-http URLs", () => {
    expect(() =>
      scrapeWebsiteToolSchema.parse({
        website_url: "file:///tmp/index.html",
      }),
    ).toThrow();
  });
});

describe("extractWebsiteText", () => {
  it("extracts readable text from HTML", () => {
    const text = extractWebsiteText(`
      <!doctype html>
      <html>
        <head>
          <title>ignored title</title>
          <style>.hidden { display: none; }</style>
          <script>console.log("ignore");</script>
        </head>
        <body>
          <h1>LangChain &amp; CrewAI</h1>
          <p>第一段&nbsp;内容</p>
          <div>第二段<br>换行</div>
        </body>
      </html>
    `);

    expect(text).toContain("LangChain & CrewAI");
    expect(text).toContain("第一段 内容");
    expect(text).toContain("第二段\n换行");
    expect(text).not.toContain("console.log");
    expect(text).not.toContain("display: none");
  });
});

describe("createScrapeWebsiteTool", () => {
  it("fetches a website and returns scraped text", async () => {
    const fetchFn = mock(async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);

      expect(url).toBe("https://example.com");
      expect(init.method).toBe("GET");
      expect(headers.get("User-Agent")).toContain("Mozilla/5.0");
      expect(headers.get("Cookie")).toBe("session=abc; theme=light");

      return htmlResponse(`
        <html>
          <body>
            <article>
              <h1>页面标题</h1>
              <p>正文内容</p>
            </article>
          </body>
        </html>
      `);
    });
    const scrapeTool = createScrapeWebsiteTool({
      cookies: { session: "abc", theme: "light" },
      fetchFn,
    });

    const result = await scrapeTool.invoke({
      website_url: "https://example.com",
    });

    expect(result).toContain("The following text is scraped website content:");
    expect(result).toContain("页面标题");
    expect(result).toContain("正文内容");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("uses a default websiteUrl when website_url is omitted", async () => {
    const fetchFn = mock(async (url: string) => {
      expect(url).toBe("https://example.com/default");
      return htmlResponse("<main>默认页面</main>");
    });
    const scrapeTool = createScrapeWebsiteTool({
      fetchFn,
      websiteUrl: "https://example.com/default",
    });

    const result = await scrapeTool.invoke({ website_url: undefined });

    expect(result).toContain("默认页面");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns an HTTP error for non-2xx responses", async () => {
    const fetchFn = mock(async () =>
      htmlResponse("not found", {
        status: 404,
        statusText: "Not Found",
      }),
    );
    const scrapeTool = createScrapeWebsiteTool({ fetchFn });

    const result = await scrapeTool.invoke({
      website_url: "https://example.com/missing",
    });

    expect(result).toContain("HTTP请求错误");
    expect(result).toContain("404");
  });

  it("returns guidance when no text can be extracted", async () => {
    const fetchFn = mock(async () =>
      htmlResponse("<script>window.__APP__ = {}</script>"),
    );
    const scrapeTool = createScrapeWebsiteTool({ fetchFn });

    const result = await scrapeTool.invoke({
      website_url: "https://example.com/app",
    });

    expect(result).toContain("未提取到网页文本");
  });

  it("returns a network error when fetch fails", async () => {
    const fetchFn = mock(async () => {
      throw new Error("network down");
    });
    const scrapeTool = createScrapeWebsiteTool({ fetchFn });

    const result = await scrapeTool.invoke({
      website_url: "https://example.com",
    });

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
    const scrapeTool = createScrapeWebsiteTool({
      fetchFn,
      timeoutMs: 1,
    });

    const result = await scrapeTool.invoke({
      website_url: "https://example.com/slow",
    });

    expect(result).toContain("请求超时");
  });
});
