import { createAgent } from "langchain";
import * as z from "zod";
import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model";
import { addImageToContentLocalTool } from "../../tools/add-image-tool-local";
import type { ImageAnalysis } from "./analysis-task";
import type { ImagePathItem } from "./index";

const llm = new AliyunQwenChatModel({
  model: "qwen3.7-plus",
  imageModel: "qwen3-vl-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

// 单张图片在小红书内置编辑器中的编辑 / P 图方案
export const ImageEditPlanSchema = z.object({
  fileName: z.string().describe("图片文件名或 ID，用于标识图片。"),
  overallEditStrategy: z
    .string()
    .describe(
      "整体编辑思路（统一使用小红书自带内置编辑能力，不推荐外部 App），例如整体画面调性、风格方向。",
    ),
  crop_suggestion: z
    .string()
    .describe("剪裁建议：横竖构图、主体位置、留白等。"),
  light_color_adjustment: z
    .string()
    .describe(
      "亮度 / 对比度 / 饱和度等基础参数调整建议，使用相对表述而非具体数值。",
    ),
  filter_suggestion: z
    .string()
    .describe("小红书内置滤镜建议，可给出滤镜系列或风格描述。"),
  text_overlay_suggestion: z
    .string()
    .describe(
      "文字建议：是否加文字、文字内容方向、出现位置与数量控制，避免遮挡关键视觉锚点。",
    ),
  beauty_adjustment_suggestion: z
    .string()
    .describe(
      "美颜建议（仅在人像时有效），强调自然不过度美颜，可给出相对强度建议。",
    ),
  is_recommended_as_cover: z.string().describe("是否建议作为首图 / 封面。"),
  risk_and_pitfall_notes: z
    .string()
    .describe(
      "需要规避的审美风险 / 平台审核风险，例如不过度裸露、避免违禁文案等。",
    ),
});
export type ImageEditPlan = z.infer<typeof ImageEditPlanSchema>;

// 基于单张图片构建编辑/P图 Task（每张图一个 Task，输出单图 ImageEdit）
function createImageEditPlanTaskMessage(
  imagePath: ImagePathItem,
  ideaText: string,
  imageAnalysis: ImageAnalysis,
) {
  return `
你将获得一张图片的信息，你需要根据用户的意图，以及对图片的视觉分析，生成一份编辑 / P 图方案：
1）用户的原始创作意图 user_raw_intent（字符串）：
   ${ideaText}
2）图片信息是（其中 path 字段为图片路径）：
   ${JSON.stringify(imagePath)}
3）图片的视觉分析结果 imageAnalysis：
   ${JSON.stringify(imageAnalysis)}
请使用 Add_Image_To_Content_Local 加载上述图片路径，对图片进行整体与细节的多维度观察，并根据视觉分析结果，给出针对该图片的具体编辑 / P 图方案。
请严格按照 ImageEditPlan 的字段要求。
如果某些方向不需要编辑，则对应字段直接输出“不需要编辑”。
注意，如果加载图片失败，或者无法获取图片内容，则输出错误信息，不要编造结果

**期望输出：**
一个能够被解析为 ImageEditPlan 的结构化输出
  `.trim();
}

const imageEditPlanSystemPrompt = `
你是：小红书笔记图片编辑与风格统筹师（MCN机构）

你的目标：
在保证真实感与平台安全的前提下，通过「轻量、可复现」的编辑决策，统一整篇笔记的视觉风格，提升点击率与完读率，而不是追求夸张或难以复刻的重度 P 图效果。

你的背景：
**一、身份与背景**
你长期为小红书头部账号和品牌合作项目提供图片编辑服务，是多家 MCN 机构签约的图片编辑与风格统筹顾问。
你极其熟悉小红书内置编辑器的功能边界，了解不同滤镜、调色预设、美颜程度在平台审核与用户感知中的风险与效果差异。
你的工作重心不是「炫技式修图」，而是用最小的编辑成本，稳定地放大图片的点击潜力与阅读体验。

**二、关键知识与理论**
- 平台合规与真实性：清楚小红书在「过度美颜」「夸大效果」「医疗/功效类」等场景下的审核红线，避免让图片触发平台风险。
- 品牌与账号风格一致性：理解不同账号调性（生活方式、专业测评、品牌官号等）的视觉风格特征，知道如何在多图场景下保持统一。
- 人像与产品处理原则：掌握「自然肤色」「皮肤质感保留」「产品细节不被遮挡」等编辑原则，避免出现失真或过度磨皮。
- 视觉动线与信息层级：通过裁剪和布局调整，让用户视线自然落在最重要的产品或信息点上。
- 轻量化编辑哲学：倾向使用少量、明确可复现的调整（如亮度/对比度/色温/裁剪），而不是堆叠复杂滤镜。

**三、工作方法与行为习惯**
- 先读「视觉分析结果」再决策：每次编辑前都会完整阅读视觉分析师的报告，优先解决其指出的问题，而不是凭直觉乱调。
- 以整篇笔记为单位思考：不是孤立地修每一张图，而是从「头图 → 关键内容图 → 氛围补充图」整体规划色调与风格。
- 优先做全局统一，再做局部微调：先统一曝光、色温与整体色调，再根据具体图片补充局部细节调整。
- 明确标记「编辑意图」：为每一项编辑建议标明目的（如「提升产品质感」「减弱背景杂乱」「突出人物表情」），方便下游理解与复用。
- 坚持可复现性：所有建议默认基于小红书内置编辑器能完成的操作，避免提出依赖专业外部软件的复杂方案。

**四、行为边界（不做什么）**
- 不从零做视觉分析，不替代视觉分析师对图片好坏做根本性判断，只在其结论基础上提出编辑方案。
- 不撰写标题或正文文案，也不设计具体的内容结构，最多只会提出图片与文案在信息对应关系上的建议。
- 不通过夸大效果（如「过度磨皮」「极端瘦身」「虚假前后对比」）来制造误导性视觉。
- 不建议使用复杂的外部软件特效，所有方案都应能在小红书内置编辑器中落地。
- 所有思考过程、工具调用和最终输出都必须使用中文

**五、工具使用要求**：
- 你必须使用 Add_Image_To_Content_Local 工具加载本地图片
`.trim();

export async function createImageEditPlanTask(
  imagePath: ImagePathItem,
  ideaText: string,
  imageAnalysis: ImageAnalysis,
) {
  const agent = createAgent({
    model: llm,
    tools: [addImageToContentLocalTool],
    systemPrompt: imageEditPlanSystemPrompt,
    responseFormat: ImageEditPlanSchema,
  });

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content: createImageEditPlanTaskMessage(
          imagePath,
          ideaText,
          imageAnalysis,
        ),
      },
    ],
  });
  return { imagePath, result };
}

function createImageEditPlanSummaryTaskMessage(context: string) {
  return `
你将获得所有图片的编辑方案，你需要总结所有图片的编辑方案，并生成一句话的整体的编辑方案总结，不要超过50个字
${context}

**期望输出：**
不输出多余内容，只输出一个一句话的整体的编辑方案总结。
注意，如果加载图片失败，或者无法获取图片内容，则输出错误信息，不要编造结果
  `.trim();
}

export function createImageEditPlanSummaryTask(context: string) {
  const agent = createAgent({
    model: llm,
    tools: [addImageToContentLocalTool],
    systemPrompt: imageEditPlanSystemPrompt,
  });

  return agent.invoke({
    messages: [
      {
        role: "user",
        content: createImageEditPlanSummaryTaskMessage(context),
      },
    ],
  });
}
