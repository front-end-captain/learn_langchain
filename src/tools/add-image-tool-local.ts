import { tool } from "@langchain/core/tools";
import * as z from "zod";

const imageMimeTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function getImageMimeType(filePath: string) {
  const lowerPath = filePath.toLowerCase();
  const ext = Object.keys(imageMimeTypes).find((suffix) =>
    lowerPath.endsWith(suffix),
  );

  return ext ? imageMimeTypes[ext] || "" : "application/octet-stream";
}

export const addImageToContentLocalTool = tool(
  async ({ image_path }) => {
    const file = Bun.file(image_path);

    if (!(await file.exists())) {
      throw new Error(`图片文件不存在: ${image_path}`);
    }

    const mimeType = getImageMimeType(image_path);

    if (!mimeType.startsWith("image/")) {
      throw new Error(`不支持的图片类型: ${image_path}`);
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return [
      `图片内容已加载: ${image_path}`,
      `data:${mimeType};base64,${base64}`,
    ].join("\n");
  },
  {
    name: "Add_Image_To_Content_Local",
    description:
      "读取本地图片文件，转换为 data URL base64 格式，并交给多模态模型分析。",
    schema: z.object({
      image_path: z.string().describe("本地图片文件的绝对路径。"),
    }),
  },
);
