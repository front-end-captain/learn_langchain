import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  createImageAnalysisTask,
  type ImageAnalysis,
  createImageAnalysisSummaryTask,
} from "./analysis-task";
import {
  createImageEditPlanTask,
  ImageEditPlanSchema,
  type ImageEditPlan,
  createImageEditPlanSummaryTask,
} from "./edit-plan-tasks";
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

export interface ImagePathItem {
  id: number;
  name: string;
  path: string;
}
function getImagePaths(): ImagePathItem[] {
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
    .map((dirent, index) => {
      return {
        id: index,
        name: dirent.name,
        path: fileURLToPath(
          new URL(`./assets/${dirent.name}`, import.meta.url),
        ),
      };
    });
}

async function runVisualAnalysisPhase(
  imagePaths: ImagePathItem[],
  ideaText: string,
) {
  const taskResults = await Promise.allSettled(
    imagePaths.map((imagePath) => createImageAnalysisTask(imagePath, ideaText)),
  );

  const imageIdToAnalysisResult = new Map<number, ImageAnalysis>();

  taskResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const parsed = ImageAnalysisSchema.parse(
        result.value.result.structuredResponse,
      );
      imageIdToAnalysisResult.set(result.value.imagePath.id, parsed);
    } else {
      console.error(`ImageAnalysisTask Failed, `, result.reason);
    }
  });
  let context = "";
  imageIdToAnalysisResult.forEach((result, imagePath) => {
    context += `图片(${imagePath}): ${JSON.stringify(result)}`;
  });
  const summaryResult = await createImageAnalysisSummaryTask(context);
  const visualAnalysisSummaryResult =
    summaryResult.messages.at(-1)?.content || "";
  return { imageIdToAnalysisResult, visualAnalysisSummaryResult };
}

async function runVisualEditPlanPhase(
  imagePaths: ImagePathItem[],
  ideaText: string,
  imageIdToAnalysisResult: Map<number, ImageAnalysis>,
) {
  const taskResults = await Promise.allSettled(
    imagePaths.map((imagePath) => {
      return createImageEditPlanTask(
        imagePath,
        ideaText,
        imageIdToAnalysisResult.get(imagePath.id)!,
      );
    }),
  );

  const imageIdToEditPlanResult = new Map<number, ImageEditPlan>();

  taskResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      try {
        const parsed = ImageEditPlanSchema.parse(
          result.value.result.structuredResponse,
        );
        imageIdToEditPlanResult.set(result.value.imagePath.id, parsed);
      } catch (error) {
        console.error(`ImageEditPlanTaskResult parse Failed, `, error);
      }
    } else {
      console.error(`ImageEditPlanTask Failed, `, result.reason);
    }
  });
  let context = "";
  imageIdToEditPlanResult.forEach((result, imagePath) => {
    context += `图片(${imagePath}): ${JSON.stringify(result)}`;
  });
  const summaryResult = await createImageEditPlanSummaryTask(context);
  const visualEditPlanSummaryResult =
    summaryResult.messages.at(-1)?.content || "";
  return { imageIdToEditPlanResult, visualEditPlanSummaryResult };
}

async function runContentPhase(
  ideaText: string,
  imagePaths: ImagePathItem[],
  imageIdToAnalysisResult: Map<string, ImageAnalysis>,
  visualAnalysisSummaryResult: string,
  imageIdToEditPlanResult: Map<string, ImageEditPlan>,
  visualEditPlanSummaryResult: string,
) {}

if (
  path
    .normalize(import.meta.url)
    .endsWith(path.normalize(process.argv[1] || ""))
) {
  const ideaText = "我想分享最近开始用地中海饮食减脂";
  const imagePaths = getImagePaths();
  console.info("imagePaths", imagePaths);

  const { imageIdToAnalysisResult, visualAnalysisSummaryResult } =
    await runVisualAnalysisPhase(imagePaths, ideaText);
  console.info("imageIdToAnalysisResult", imageIdToAnalysisResult);
  console.info("visualAnalysisSummaryResult", visualAnalysisSummaryResult);

  const { imageIdToEditPlanResult, visualEditPlanSummaryResult } =
    await runVisualEditPlanPhase(imagePaths, ideaText, imageIdToAnalysisResult);
  console.info("imageIdToEditPlanResult", imageIdToEditPlanResult);
  console.info("visualEditPlanSummaryResult", visualEditPlanSummaryResult);

  // console.info(JSON.stringify(result, null, 2));
}
