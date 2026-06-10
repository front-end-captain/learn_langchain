import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createImageAnalysisTask,
  type ImageAnalysis,
  createImageAnalysisSummaryTask,
} from "./tasks";
import { ImageAnalysisSchema } from "../lesson2/agent";

const imageExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
]);

const assetsPath = fileURLToPath(new URL("./assets/", import.meta.url));

function getImagePaths() {
  return readdirSync(assetsPath, { withFileTypes: true })
    .filter((dirent) => {
      if (!dirent.isFile()) {
        return false;
      }

      const lastDotIndex = dirent.name.lastIndexOf(".");
      if (lastDotIndex === -1) {
        return false;
      }

      return imageExtensions.has(dirent.name.slice(lastDotIndex).toLowerCase());
    })
    .map((dirent) =>
      fileURLToPath(new URL(`./assets/${dirent.name}`, import.meta.url)),
    )
    .sort();
}

async function runVisualAnalysisPhase(imagePaths: string[], ideaText: string) {
  const taskResults = await Promise.all(
    imagePaths.map((imagePath) => createImageAnalysisTask(imagePath, ideaText)),
  );

  const taskRespList = taskResults.map((taskResult) => {
    return ImageAnalysisSchema.parse(taskResult.structuredResponse);
  });
  const summaryResult = await createImageAnalysisSummaryTask(
    taskRespList.map((t) => JSON.stringify(t)),
  );
  console.info("summaryResult", summaryResult.messages[0]?.content || "");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runVisualAnalysisPhase(
    getImagePaths(),
    "我想分享最近开始用地中海饮食减脂",
  );

  // console.info(JSON.stringify(result, null, 2));
}
