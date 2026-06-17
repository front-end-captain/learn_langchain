import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as Lark from "@larksuiteoapi/node-sdk";

import type { Attachment } from "../models.ts";

export interface FeishuDownloaderOptions {
  client: Lark.Client;
  dataDir: string;
}

export class FeishuDownloader {
  private readonly client: Lark.Client;
  private readonly dataDir: string;

  constructor(options: FeishuDownloaderOptions) {
    this.client = options.client;
    this.dataDir = options.dataDir;
  }

  async download(
    msgId: string,
    attachment: Attachment,
    sessionId: string,
  ): Promise<string | null> {
    const destPath = join(
      this.dataDir,
      "workspace",
      "sessions",
      sessionId,
      "uploads",
      attachment.fileName,
    );

    try {
      await mkdir(dirname(destPath), { recursive: true });
      const response = await this.client.im.v1.messageResource.get({
        params: {
          type: attachment.msgType,
        },
        path: {
          message_id: msgId,
          file_key: attachment.fileKey,
        },
      });

      await response.writeFile(destPath);
      return destPath;
    } catch (error) {
      console.error(
        "fo下载附件异常",
        `msg_id=${msgId}`,
        `file_key=${attachment.fileKey}`,
        error,
      );
      return null;
    }
  }
}
