import { createAgent } from "langchain";
import * as z from "zod";
import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model";
import { addImageToContentLocalTool } from "../../tools/add-image-tool-local";
import type { ImagePathItem } from "./index";

const llm = new AliyunQwenChatModel({
  model: "qwen3.7-plus",
  imageModel: "qwen3-vl-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

const ImageAnalysisSchema = z.object({
  fileName: z.string().describe("图片文件名或 ID，用于标识图片。"),
  subjectDescription: z
    .string()
    .describe(
      "【主体内容】客观描述画面中的核心物体、人物或场景，要求详细准确，不遗漏关键元素。",
    ),
  atmosphereVibe: z
    .string()
    .describe(
      "【风格氛围】用形容词描述画面的情绪价值和整体氛围感，例如：静谧、复古、松弛感、治愈、精致等。",
    ),
  visualDetails: z
    .array(z.string())
    .min(3)
    .describe("【细节点列表】列出画面中容易被忽略但具象的元素，至少 3 个。"),
  imageQualityScore: z
    .string()
    .describe(
      "【质量评价】1-10 分打分，基于构图、光线和清晰度三个维度，并给出打分原因。",
    ),
  highlightFeature: z
    .string()
    .describe("【突出特点】这张图最抓人眼球的一个视觉锚点 Visual Hook。"),
});
export type ImageAnalysis = z.infer<typeof ImageAnalysisSchema>;

// 基于单张图片构建视觉分析 Task（每张图一个 Task，输出单图 ImageAnalysis）
function createImageAnalysisTaskMessage(
  imagePath: ImagePathItem,
  ideaText: string,
) {
  return `
    你需要根据用户的意图，对一张图片进行深入的视觉分析。：
    1）用户的原始创作意图 user_raw_intent（字符串）：
       ${ideaText}
    2）图片的信息是(其中 path 是图片的路径)：
       ${JSON.stringify(imagePath)}
    请使用 Add_Image_To_Content_Local 加载上述图片路径，对图片进行整体与细节的多维度观察，
    并按照 ImageAnalysis 的字段要求，输出结构化的视觉分析结果。
    注意，如果加载图片失败，或者无法获取图片内容，则输出错误信息，不要编造结果

    **强调输出格式：**
    - 当输出Final Answer时，Final Answer:后面必须是纯JSON，不要使用代码块标记，不要有任何包装
    - 对于没有内容的字段，可以用合理的中文描述（如 "暂无可分析内容"），不要用形如 "" "" 的错误写法
    - 尽量对每个字段给出充实、有信息量的中文描述

    **期望输出：**
    一个能够被解析为 ImageAnalysis 的结构化输出，包含所有必填字段。
  `.trim();
}

const imageAnalysisSystemPrompt = `
你是：资深小红书笔记视觉分析师（MCN机构方向）

你的目标：
在任何图片评估场景下，优先从「平台审美 + 情绪价值 + 商业转化」三重视角给出客观、可执行的视觉判断，为后续策略、编辑与文案提供稳定可靠的决策依据

你的背景：
**一、身份与背景**
你是一位拥有 8 年以上经验的产品视觉分析师，长期服务于国内头部 MCN 机构和小红书内容创作团队。
你深谙小红书平台的视觉内容标准和用户审美偏好，熟悉各品类在「种草场景」「生活方式展示」「专业测评」等不同内容形态下的视觉风格差异。
你始终站在「内容决策前置环节」的位置，用专业的视觉判断为选图、拍摄方向和内容策划提供依据，而不是去做后端的 P 图或文案修改。

**二、关键知识与理论**
- 视觉锚点理论（Visual Hook）：理解哪些元素能够在 1 秒内抓住用户注意力，并能准确指出这些锚点在画面中的位置与作用。
- 情绪价值传递：不仅关注产品是否清晰可见，更关注画面是否能传递「氛围感」「生活方式想象」「安全感/疗愈感」等情绪。
- 小红书视觉标准：构图简洁、光线柔和、色彩协调、细节丰富，尤其关注头图在瀑布流和搜索列表中的辨识度与点击吸引力。
- 质量评估维度：从构图、光线、清晰度、色彩等维度综合评估，对低质图片能给出清晰的「不可用原因」与「替代建议方向」。
- 头图策略：理解头图在推荐分发和搜索卡片中的曝光机制，倾向选择最能代表笔记核心价值、又足够抓眼的图片作为头图候选。

**三、工作方法与行为习惯**
- 始终先整体后局部：先给出画面整体印象和氛围，再下沉到主体、背景、道具、细节逐层拆解，而不是一开始就陷入局部瑕疵。
- 坚持结构化表达：每次输出都尽量遵循「整体印象 → 主体与构图 → 光线与色彩 → 细节与情绪 → 适配场景建议」的结构，方便下游直接引用。
- 明确标记视觉锚点：习惯性指出画面中最能抓住注意力的位置，并说明其适合作为头图、列表图还是正文插图。
- 区分「可优化」与「不可用」：对图片质量的判断不是简单好/不好，而是给出「通过轻量编辑可用」还是「需重新拍摄」的清晰建议。
- 优先考虑下游需求：在分析时会显式思考「这张图对策略、文案、SEO 各自的价值」，而不是只从视觉美观做孤立判断。

**四、行为边界（不做什么）**
- 只负责视觉分析与评估，不进行任何形式的图片编辑方案设计或具体 P 图指令，这属于图片编辑师的职责。
- 不撰写或改写文案，不输出完整的内容结构或标题方案，只会从画面角度给出对文案创作的提示。
- 不对图片意图进行过度脑补和主观故事化解读，分析必须基于画面可见信息本身。
- 不以个人审美取代平台与目标人群的审美偏好，所有判断都要尽量可被解释和复用。
- 所有思考过程、工具调用和最终输出都必须使用中文。
- 如果图片内容加载失败，直接返回错误，不要自己瞎编
- 不允许委派给其他 Agent

**五、工具使用要求**：
- 你必须使用 Add_Image_To_Content_Local 工具加载本地图片
`.trim();

export async function createImageAnalysisTask(
  imagePath: ImagePathItem,
  ideaText: string,
) {
  const agent = createAgent({
    model: llm,
    tools: [addImageToContentLocalTool],
    systemPrompt: imageAnalysisSystemPrompt,
    responseFormat: ImageAnalysisSchema,
  });

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content: createImageAnalysisTaskMessage(imagePath, ideaText),
      },
    ],
  });

  return { imagePath, result };
}

function createImageAnalysisSummaryTaskMessage(context: string) {
  return `
你将获得所有图片的视觉分析结果，你需要总结所有图片的视觉分析结果，并生成一句话的整体的视觉分析报告总结，不要超过50个字。
${context}

**期望输出：**
不输出多余内容，只输出一个一句话的整体的视觉分析报告总结。
注意，如果加载图片失败，或者无法获取图片内容，则输出错误信息，不要编造结果
  `.trim();
}

export function createImageAnalysisSummaryTask(context: string) {
  const agent = createAgent({
    model: llm,
    tools: [addImageToContentLocalTool],
    systemPrompt: imageAnalysisSystemPrompt,
  });

  return agent.invoke({
    messages: [
      {
        role: "user",
        content: createImageAnalysisSummaryTaskMessage(context),
      },
    ],
  });
}
