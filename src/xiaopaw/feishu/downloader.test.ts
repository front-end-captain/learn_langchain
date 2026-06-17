import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as Lark from "@larksuiteoapi/node-sdk";

import { FeishuDownloader } from "./downloader.ts";
import type { Attachment } from "../models.ts";

function createClient(input?: {
  get?: (payload: unknown) => Promise<{ writeFile: () => Promise<unknown> }>;
}): Lark.Client & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    im: {
      v1: {
        messageResource: {
          // @ts-ignore
          get: async (payload: unknown) => {
            calls.push(payload);
            if (input?.get) {
              const resp = await input.get(payload);
              return resp;
            }
            return {
              writeFile: async (path: string) => {
                await writeFile(path, "file-content", "utf8");
              },
            };
          },
        },
      },
    },
  };
}

describe("FeishuDownloader", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
  });

  it("downloads resource into session uploads directory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "feishu-downloader-"));
    tempDirs.push(dataDir);
    const client = createClient();
    const downloader = new FeishuDownloader({ client, dataDir });
    const attachment: Attachment = {
      msgType: "file",
      fileKey: "file_001",
      fileName: "report.txt",
    };

    const path = await downloader.download("om_001", attachment, "s-001");

    expect(path).toBe(
      join(dataDir, "workspace", "sessions", "s-001", "uploads", "report.txt"),
    );
    expect(await readFile(path ?? "", "utf8")).toBe("file-content");
    expect(client.calls[0]).toMatchObject({
      params: { type: "file" },
      path: {
        message_id: "om_001",
        file_key: "file_001",
      },
    });
  });

  it("passes image type to message resource api", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "feishu-downloader-"));
    tempDirs.push(dataDir);
    const client = createClient();
    const downloader = new FeishuDownloader({ client, dataDir });

    await downloader.download(
      "om_img",
      { msgType: "image", fileKey: "img_001", fileName: "img_001.jpg" },
      "s-img",
    );

    expect(client.calls[0]).toMatchObject({
      params: { type: "image" },
    });
  });

  it("returns null when sdk throws", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "feishu-downloader-"));
    tempDirs.push(dataDir);
    const client = createClient({
      get: () => {
        throw new Error("network");
      },
    });
    const downloader = new FeishuDownloader({ client, dataDir });

    await expect(
      downloader.download(
        "om_001",
        { msgType: "file", fileKey: "file_001", fileName: "report.txt" },
        "s-001",
      ),
    ).resolves.toBeNull();
  });
});
