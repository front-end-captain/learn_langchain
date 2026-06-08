/**
课程：10｜多模态模型：让你的Agent拥有"眼睛" 示例代码
多模态视觉分析示例

演示如何使用多模态 Agent 分析本地图片，生成结构化的视觉分析报告。

本示例展示了：
1. 多模态 Agent 配置：如何使用 AddImageToolLocal 处理本地图片
2. 图片处理流程：读取本地文件 → 转换为 Base64 → 传递给多模态模型
3. 结构化输出：使用 Pydantic 模型定义视觉分析报告的结构
4. 中间思考保存：使用 IntermediateTool 保存 Agent 的思考过程
5. Agent 人设优化：如何通过 backstory 塑造专业的视觉分析师

适用场景：
- 产品图片质量评估
- 视觉内容分析
- 图片素材筛选
- 小红书笔记配图分析

学习要点：
- 多模态能力：如何让 Agent 具备"看"的能力
- 图片处理：如何将本地图片转换为模型可处理的格式
- 结构化输出：如何定义视觉分析的结构化数据格式
- 工具集成：如何集成图片处理工具到 Agent 中
*/

import path from "path";
import { createAgent } from "langchain";
import * as z from "zod";
import { fileURLToPath } from "node:url";
import { AliyunQwenChatModel } from "../llm/aliyun-qwen-chat-model";
import { addImageToContentLocalTool } from "../tools/add-image-tool-local";

// 单张图片的深度分析详情
// 用于结构化输出图片分析的各个维度信息，包括主体内容、风格氛围、
// 视觉细节、质量评分和突出特点等。
export const ImageAnalysisSchema = z.object({
  fileName: z.string().describe("图片文件名或ID，用于标识图片。"),
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
    .describe(
      "【细节点列表】列出画面中容易被忽略但具象的元素，至少3个，这些细节可以作为后续笔记撰写的素材。",
    ),
  imageQualityScore: z
    .string()
    .describe(
      "【质量评价】1-10分打分，基于构图、光线和清晰度三个维度，并给出打分的原因和具体评价。",
    ),
  highlightFeature: z
    .string()
    .describe(
      "【突出特点】这张图最抓人眼球的一个视觉锚点（Visual Hook），是用户第一眼看到图片时最容易被吸引的元素。",
    ),
});
type ImageAnalysis = z.infer<typeof ImageAnalysisSchema>;

const ImageAnalysisSystemPrompt = `
你是：资深小红书笔记MCN机构视觉分析师。

你的目标：
分析本地产品图片，提供详细、专业、结构化的视觉分析报告，为后续内容创作提供视觉素材评估和选择依据。

你的背景：
你是一位拥有8年以上经验的产品视觉分析师，曾服务于国内头部MCN机构和小红书内容创作团队。
你深谙小红书平台的视觉内容标准和用户审美偏好，擅长从商业和内容创作的角度分析图片。

**核心理论储备**：
- 视觉锚点理论（Visual Hook）：图片中能够第一时间抓住用户注意力的元素
- 情绪价值传递：图片不仅要展示产品，更要传递情绪和氛围感
- 小红书视觉标准：构图简洁、光线柔和、色彩协调、细节丰富
- 质量评估维度：构图（30%）、光线（30%）、清晰度（20%）、色彩（20%）

**分析流程**：
1. 整体观察：首先观察图片的整体构图、色调和氛围感
2. 主体识别：识别图片中的核心主体（产品、人物、场景等）
3. 细节挖掘：寻找画面中容易被忽略但具有价值的细节元素
4. 质量评估：从构图、光线、清晰度三个维度进行客观评分
5. 视觉锚点：识别最能吸引用户注意力的视觉元素

**分析原则**：
- 客观性：描述要客观准确，不夸大不贬低
- 专业性：使用专业的视觉分析术语
- 实用性：分析结果要能为后续内容创作提供实际指导
- 细节性：不遗漏关键细节，这些细节可能是内容创作的素材

**行为边界**：
- 只负责视觉分析，不进行内容策划或文案撰写
- 分析要基于图片本身，不进行过度解读
- 评分要客观公正，给出明确的评分依据
- 不允许委派给其他 Agent
- 所有思考过程、工具调用和最终输出都必须使用中文

**结构化输出要求**：
最终结果必须符合 ImageAnalysis 结构。
不要在结构化结果之外额外输出无关解释。
`;

function createImageAnalysisTaskMessage(image_path: string) {
  return `
**任务要求**：
1. 使用 Add image to content Local 加载并分析本地图片：${image_path}
2. 如果用户提供了图片内容，直接读取图片内容
3. 仔细观察图片的各个维度，包括构图、光线、色彩、细节等
4. 按照 ImageAnalysis 模型的要求，提供详细、专业的分析报告

**分析维度**：
1. **主体内容描述**：
   - 客观描述画面中的核心物体、人物或场景
   - 要求详细准确，不遗漏关键元素
   - 描述要具体，避免泛泛而谈

2. **风格氛围分析**：
   - 用形容词描述画面的情绪价值和整体氛围感
   - 例如：静谧、复古、松弛感、治愈、精致、温暖等
   - 要能体现图片传递的情绪价值

3. **视觉细节挖掘**：
   - 列出画面中容易被忽略但具象的元素
   - 至少列出3个细节，这些细节可以作为后续笔记撰写的素材
   - 细节要具体，例如："书页上的光斑"、"杯口边缘的咖啡渍"等

4. **质量评估**：
   - 从构图、光线、清晰度三个维度进行1-10分打分
   - 给出每个维度的具体评分和评分依据
   - 提供综合评分和总体评价

5. **视觉锚点识别**：
   - 识别这张图最抓人眼球的一个视觉锚点（Visual Hook）
   - 这是用户第一眼看到图片时最容易被吸引的元素
   - 要说明为什么这个元素能够成为视觉锚点

**重要提示**：
- 必须使用 AddImageToolLocal 加载图片（图片路径已提供）
- 如果图片内容加载失败，直接返回错误，不要自己瞎编
- 分析要客观专业，不进行过度解读
- 使用 IntermediateTool 保存中间思考过程
- 所有输出必须使用中文
- 确保输出符合 ImageAnalysis 模型的所有字段要求
`.trim();
}

const llm = new AliyunQwenChatModel({
  model: "qwen3.7-plus",
  imageModel: "qwen3-vl-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

const imageAnalysis = createAgent({
  model: llm,
  tools: [addImageToContentLocalTool],
  systemPrompt: ImageAnalysisSystemPrompt,
  responseFormat: ImageAnalysisSchema,
});
const imagePath = fileURLToPath(
  new URL("./20260202161329_150_6.jpg", import.meta.url),
);
const stream = await imageAnalysis.stream(
  {
    messages: [
      {
        role: "user",
        content: createImageAnalysisTaskMessage(imagePath),
      },
    ],
  },
  {
    streamMode: "values",
  },
);

for await (const chunk of stream) {
  const lastMessage = chunk.messages.at(-1);

  console.log("\n==============================");
  console.log("最新消息类型:", lastMessage?.getType?.());
  console.log("最新消息内容:", lastMessage?.content);

  if ("tool_calls" in (lastMessage ?? {})) {
    // @ts-ignore
    console.log("工具调用:", lastMessage?.tool_calls);
  }

  if (chunk.structuredResponse) {
    console.log("结构化输出:", chunk.structuredResponse);
  }
}
