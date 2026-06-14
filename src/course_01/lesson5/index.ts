import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  createImageAnalysisTask,
  ImageAnalysisSchema,
  type ImageAnalysis,
  createImageAnalysisSummaryTask,
} from "./analysis-task";
import {
  createImageEditPlanTask,
  ImageEditPlanSchema,
  type ImageEditPlan,
  createImageEditPlanSummaryTask,
} from "./edit-plan-tasks";
import { createcontentStrategyTask } from "./content-task";
import { createCopywritingTask } from "./copyrighting-task";
import { createSEOOptimizedNoteTask } from "./seo-optimization-task";

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

  taskResults.forEach((result) => {
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
  const visualAnalysisSummaryResult = (summaryResult.messages.at(-1)?.content ||
    "") as string;
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

  taskResults.forEach((result) => {
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
  const visualEditPlanSummaryResult = (summaryResult.messages.at(-1)?.content ||
    "") as string;
  return { imageIdToEditPlanResult, visualEditPlanSummaryResult };
}

async function runContentPhase(
  ideaText: string,
  imageIdToAnalysisResult: Map<number, ImageAnalysis>,
  visualAnalysisSummaryResult: string,
  imageIdToEditPlanResult: Map<number, ImageEditPlan>,
  visualEditPlanSummaryResult: string,
) {
  const visualReport = JSON.stringify({
    user_raw_intent: ideaText,
    images_visual: Array.from(imageIdToAnalysisResult.values()),
    summary: visualAnalysisSummaryResult,
  });
  const editReport = JSON.stringify({
    images_edit_plan: Array.from(imageIdToEditPlanResult.values()),
    summary: visualEditPlanSummaryResult,
  });
  const contentStrategyResult = await createcontentStrategyTask(
    ideaText,
    visualReport,
    editReport,
  );
  const copywritingResult = await createCopywritingTask(
    ideaText,
    visualReport,
    editReport,
    JSON.stringify(contentStrategyResult.structuredResponse),
  );
  const seoOptimizedNoteResult = await createSEOOptimizedNoteTask(
    JSON.stringify(contentStrategyResult.structuredResponse),
    JSON.stringify(copywritingResult.structuredResponse),
  );
  return seoOptimizedNoteResult.structuredResponse;
}

if (
  path
    .normalize(import.meta.url)
    .endsWith(path.normalize(process.argv[1] || ""))
) {
  const ideaText = "我想分享最近开始用地中海饮食减脂";
  const imagePaths = getImagePaths();

  const { imageIdToAnalysisResult, visualAnalysisSummaryResult } =
    await runVisualAnalysisPhase(imagePaths, ideaText);
  // console.info("imageIdToAnalysisResult", imageIdToAnalysisResult);
  // console.info("visualAnalysisSummaryResult", visualAnalysisSummaryResult);

  const { imageIdToEditPlanResult, visualEditPlanSummaryResult } =
    await runVisualEditPlanPhase(imagePaths, ideaText, imageIdToAnalysisResult);
  // console.info("imageIdToEditPlanResult", imageIdToEditPlanResult);
  // console.info("visualEditPlanSummaryResult", visualEditPlanSummaryResult);

  const seoNote = await runContentPhase(
    ideaText,
    imageIdToAnalysisResult,
    visualAnalysisSummaryResult,
    imageIdToEditPlanResult,
    visualEditPlanSummaryResult,
  );

  let plan = "";
  imageIdToEditPlanResult.forEach((item, id) => {
    plan += `图片ID：${id}\n`;
    plan += `图片编辑方案: ${item.overallEditStrategy}\n`;
    plan += `图片剪裁建议: ${item.crop_suggestion}\n`;
    plan += `图片亮度/对比度/饱和度调整建议: ${item.light_color_adjustment}\n`;
    plan += `图片滤镜建议: ${item.filter_suggestion}\n`;
    plan += `图片文字建议: ${item.text_overlay_suggestion}\n`;
    plan += `图片美颜建议: ${item.beauty_adjustment_suggestion}\n`;
    plan += `图片是否建议作为首图: ${item.is_recommended_as_cover}\n`;
    plan += `图片需要规避的审美风险/平台审核风险: ${item.risk_and_pitfall_notes}\n`;
    plan += "\n";
  });

  const finalReport = `
原始创作意图: ${ideaText}
生成笔记标题: ${seoNote.optimizedTitle}
生成笔记正文: ${seoNote.optimizedContent}
生成笔记图片顺序: ${seoNote.optimizedPictureOrder}
生成笔记标签: ${seoNote.tags}
生成笔记图片编辑方案: \n
${plan}
  `;

  console.info(finalReport);
}
