import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  createImageAnalysisTask,
  type ImageAnalysis,
  createImageAnalysisSummaryTask,
  createImageEditPlanTask,
  ImageEditPlanSchema,
  type ImageEditPlan,
  createImageEditPlanSummaryTask,
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
  const taskResults = await Promise.allSettled(
    imagePaths.map((imagePath) => createImageAnalysisTask(imagePath, ideaText)),
  );

  const imagePathToAnalysisResult = new Map<string, ImageAnalysis>()

  taskResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const parsed = ImageAnalysisSchema.parse(result.value.structuredResponse);
      imagePathToAnalysisResult.set(imagePaths[index]!, parsed)
    } else {
      console.error(`ImageAnalysisTask Failed: ${imagePaths[index]}`, result.reason);
    }
  });
  let context = ''
  imagePathToAnalysisResult.forEach((result, imagePath) => {
    context += `图片(${imagePath}): ${JSON.stringify(result)}`
  })
  const summaryResult = await createImageAnalysisSummaryTask(
    context,
  );
  const visualAnalysisSummaryResult = summaryResult.structuredResponse;
  return { imagePathToAnalysisResult, visualAnalysisSummaryResult }
}


async function runVisualEditPlanPhase(imagePaths: string[], ideaText: string, imagePathToAnalysisResult: Map<string, ImageAnalysis>) {
  const taskResults = await Promise.allSettled(
    imagePaths.map((imagePath) => {
      return createImageEditPlanTask(imagePath, ideaText, imagePathToAnalysisResult.get(imagePath)!)
    }),
  );

  const imagePathToEditPlanResult = new Map<string, ImageEditPlan>()

  taskResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const parsed = ImageEditPlanSchema.parse(result.value.structuredResponse);
      imagePathToEditPlanResult.set(imagePaths[index]!, parsed)
    } else {
      console.error(`ImageEditPlanTask Failed: ${imagePaths[index]}`, result.reason);
    }
  });
  let context = ''
  imagePathToEditPlanResult.forEach((result, imagePath) => {
    context += `图片(${imagePath}): ${JSON.stringify(result)}`

  })
  const summaryResult = await createImageEditPlanSummaryTask(
    context,
  );
  const visualEditPlanSummaryResult = summaryResult.messages[0]?.content || "";
  return { imagePathToEditPlanResult, visualEditPlanSummaryResult }
}

if (path.normalize(import.meta.url).endsWith(path.normalize(process.argv[1] || ''))) {
  const imagePaths = getImagePaths()
  const ideaText = "我想分享最近开始用地中海饮食减脂"
  const { imagePathToAnalysisResult, visualAnalysisSummaryResult } = await runVisualAnalysisPhase(
    imagePaths,
    ideaText
  );
  console.info('imagePathToAnalysisResult', imagePathToAnalysisResult)
  console.info('visualAnalysisSummaryResult', visualAnalysisSummaryResult)
  const { imagePathToEditPlanResult, visualEditPlanSummaryResult } = await runVisualEditPlanPhase(imagePaths, ideaText, imagePathToAnalysisResult)
  console.info('imagePathToEditPlanResult', imagePathToEditPlanResult)
  console.info('visualEditPlanSummaryResult', visualEditPlanSummaryResult)

  // console.info(JSON.stringify(result, null, 2));
}
