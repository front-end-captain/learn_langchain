# CrewAI 多模态视觉分析迁移方案

> 目标：将 CrewAI 示例 `/Users/viking/workspaces/crewai_mas_demo/m2l6/m2l6_agent.py` 按当前项目的 LangChain + TypeScript 范式实现。
>
> 参考：`docs/lesson2-implementation.md`

---

## 1. 设计的核心结论

从第一性原理看，原 Python 示例的本质不是 CrewAI，而是四件事：

```text
本地图片文件
  ↓
转成模型可消费的多模态输入
  ↓
用视觉分析师 Agent prompt 约束分析方式
  ↓
用结构化 schema 约束最终输出
```

所以在当前 LangChain + TypeScript 项目里，不应该逐行翻译 CrewAI，而应该这样映射：

```text
本地图片读取工具
  ↓
返回 data:image/...;base64,...
  ↓
AliyunQwenChatModel 自动切换到视觉模型
  ↓
createAgent + Zod responseFormat 输出结构化结果
```

---

## 2. CrewAI 到 LangChain TS 的映射

| CrewAI 概念 | Python 写法 | LangChain TS 实现 |
|---|---|---|
| `ImageAnalysis(BaseModel)` | Pydantic 输出模型 | `z.object(...)` |
| `Agent(role/goal/backstory)` | Agent 人设 | `systemPrompt` |
| `AddImageToolLocal()` | 读取本地图片并转 Base64 | 自定义 LangChain tool |
| `IntermediateTool()` | 保存中间思考 | 复用 `saveIntermediateProductTool` |
| `output_pydantic=ImageAnalysis` | 结构化输出 | `responseFormat: ImageAnalysisSchema` |
| `Crew(...).kickoff()` | 启动任务 | `agent.invoke({ messages })` |
| `image_model="qwen3-vl-plus"` | 多模态模型 | 复用 `AliyunQwenChatModel.imageModel` |

关键点：当前项目的 `AliyunQwenChatModel` 已经有多模态适配逻辑。它会检测 tool 返回中的 `data:image/...;base64,...`，然后切换到 `imageModel`。

所以最稳妥的实现方式是：

```text
让 AddImageToolLocal 工具读取本地图片
  ↓
返回 data:image/jpeg;base64,...
  ↓
AliyunQwenChatModel 自动识别图片 tool result
  ↓
下一轮请求使用 qwen3-vl-plus
```

这和 Python 里的 `AddImageToolLocal` 思路最接近。

---

## 3. 建议新增本地图片工具

建议新增：

```text
src/tools/add-image-tool-local.ts
```

实现如下：

```ts
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

  return ext ? imageMimeTypes[ext] : "application/octet-stream";
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
```

为什么工具名用 `Add_Image_To_Content_Local`，而不是 Python 里的 `"Add image to content Local"`？

因为 LangChain / Function Calling 工具名通常更适合使用字母、数字、下划线，避免空格导致模型或 API 兼容性问题。Prompt 里也要使用这个精确名称。

---

## 4. lesson 实现主体

建议新增或完善：

```text
src/course_01/lesson4.ts
```

核心代码可以这样写：

```ts
/**
 从“文字 Agent” -> “多模态视觉 Agent”

 CrewAI 示例 m2l6_agent.py 的核心能力：
 - AddImageToolLocal：读取本地图片并转为 Base64
 - ImageAnalysis：用 Pydantic 定义视觉分析输出契约
 - Agent role / goal / backstory：塑造视觉分析师人设
 - Task description：要求 Agent 使用工具加载图片并输出结构化报告

 在 LangChain + TypeScript 中对应为：
 - addImageToContentLocalTool：读取本地图片并返回 data:image/...;base64,...
 - ImageAnalysisSchema：用 Zod 定义结构化输出
 - systemPrompt：承载 Agent 的 role / goal / backstory / 行为边界
 - responseFormat：约束最终 structuredResponse
 */

import { createAgent } from "langchain";
import * as z from "zod";
import { fileURLToPath } from "node:url";
import { AliyunQwenChatModel } from "../llm/aliyun-qwen-chat-model";
import { saveIntermediateProductTool } from "../tools/intermediate-tool";
import { addImageToContentLocalTool } from "../tools/add-image-tool-local";

const ImageAnalysisSchema = z.object({
  file_name: z.string().describe("图片文件名或 ID，用于标识图片。"),

  subject_description: z
    .string()
    .describe(
      "【主体内容】客观描述画面中的核心物体、人物或场景，要求详细准确，不遗漏关键元素。",
    ),

  atmosphere_vibe: z
    .string()
    .describe(
      "【风格氛围】用形容词描述画面的情绪价值和整体氛围感，例如：静谧、复古、松弛感、治愈、精致等。",
    ),

  visual_details: z
    .array(z.string())
    .min(3)
    .describe(
      "【细节点列表】列出画面中容易被忽略但具象的元素，至少 3 个。",
    ),

  image_quality_score: z
    .string()
    .describe(
      "【质量评价】1-10 分打分，基于构图、光线和清晰度三个维度，并给出原因。",
    ),

  highlight_feature: z
    .string()
    .describe(
      "【突出特点】这张图最抓人眼球的一个视觉锚点 Visual Hook。",
    ),
});

type ImageAnalysis = z.infer<typeof ImageAnalysisSchema>;

const imageAnalystSystemPrompt = `
你是：资深小红书笔记 MCN 机构视觉分析师。

你的目标：
分析本地产品图片，提供详细、专业、结构化的视觉分析报告，为后续内容创作提供视觉素材评估和选择依据。

你的背景：
你是一位拥有 8 年以上经验的产品视觉分析师，曾服务于国内头部 MCN 机构和小红书内容创作团队。
你深谙小红书平台的视觉内容标准和用户审美偏好，擅长从商业和内容创作的角度分析图片。

**核心理论储备**：
- 视觉锚点理论 Visual Hook：图片中能够第一时间抓住用户注意力的元素
- 情绪价值传递：图片不仅要展示产品，更要传递情绪和氛围感
- 小红书视觉标准：构图简洁、光线柔和、色彩协调、细节丰富
- 质量评估维度：构图 30%、光线 30%、清晰度 20%、色彩 20%

**分析流程**：
1. 整体观察：首先观察图片的整体构图、色调和氛围感
2. 主体识别：识别图片中的核心主体，包括产品、人物、场景等
3. 细节挖掘：寻找画面中容易被忽略但具有价值的细节元素
4. 质量评估：从构图、光线、清晰度三个维度进行客观评分
5. 视觉锚点：识别最能吸引用户注意力的视觉元素

**工具使用要求**：
- 你必须使用 Add_Image_To_Content_Local 工具加载本地图片
- 你必须使用 Save_Intermediate_Product_Tool 工具保存中间分析过程

**行为边界**：
- 只负责视觉分析，不进行内容策划或文案撰写
- 分析要基于图片本身，不进行过度解读
- 评分要客观公正，给出明确的评分依据
- 如果图片加载失败，直接说明错误，不要编造图片内容
- 所有思考过程、工具调用和最终输出都必须使用中文

**结构化输出要求**：
最终结果必须符合 ImageAnalysis 结构。
不要在结构化结果之外额外输出无关解释。
`.trim();

function createImageAnalysisTaskMessage(imagePath: string) {
  return `
**任务要求**：
1. 使用 Add_Image_To_Content_Local 工具加载并分析本地图片：${imagePath}
2. 仔细观察图片的构图、光线、色彩、清晰度和细节
3. 使用 Save_Intermediate_Product_Tool 保存中间分析过程
4. 按照 ImageAnalysis 结构输出详细、专业的视觉分析报告

**分析维度**：
1. 主体内容描述：
   - 客观描述画面中的核心物体、人物或场景
   - 要求详细准确，不遗漏关键元素

2. 风格氛围分析：
   - 用形容词描述画面的情绪价值和整体氛围感
   - 例如：静谧、复古、松弛感、治愈、精致、温暖等

3. 视觉细节挖掘：
   - 列出画面中容易被忽略但具象的元素
   - 至少列出 3 个细节

4. 质量评估：
   - 从构图、光线、清晰度三个维度进行 1-10 分打分
   - 给出每个维度的评分依据
   - 提供综合评分和总体评价

5. 视觉锚点识别：
   - 找出这张图最抓人眼球的一个视觉锚点
   - 说明为什么这个元素能成为视觉锚点

**重要提示**：
- 必须基于图片本身进行分析
- 图片加载失败时不要编造内容
- 所有输出必须使用中文
`.trim();
}

const imagePath = fileURLToPath(
  new URL("./20260202161329_150_6.jpg", import.meta.url),
);

const llm = new AliyunQwenChatModel({
  model: "qwen-plus",
  imageModel: "qwen3-vl-plus",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

const imageAnalyst = createAgent({
  model: llm,
  tools: [addImageToContentLocalTool, saveIntermediateProductTool],
  systemPrompt: imageAnalystSystemPrompt,
  responseFormat: ImageAnalysisSchema,
});


console.log("=".repeat(80));
console.log("开始执行多模态视觉分析任务...");
console.log("=".repeat(80));
console.log("图片路径:", imagePath);
console.log("Agent: 资深小红书笔记 MCN 机构视觉分析师");
console.log("模型: qwen3-vl-plus");
console.log("=".repeat(80));

const stream = await imageAnalyst.stream(
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

let finalAnalysis: ImageAnalysis | undefined;

for await (const chunk of stream) {
  const lastMessage = chunk.messages.at(-1);

  console.log("\n" + "=".repeat(80));
  console.log("Agent 执行状态更新");
  console.log("=".repeat(80));

  console.log("最新消息类型:", lastMessage?.getType?.());

  if (lastMessage?.content) {
    console.log("最新消息内容:");
    console.log(maskBase64ImageContent(lastMessage.content));
  }

  if ("tool_calls" in (lastMessage ?? {})) {
    // @ts-ignore
    const toolCalls = lastMessage?.tool_calls;

    if (toolCalls?.length) {
      console.log("\n工具调用:");
      console.log(JSON.stringify(toolCalls, null, 2));
    }
  }

  if (chunk.structuredResponse) {
    finalAnalysis = chunk.structuredResponse as ImageAnalysis;

    console.log("\n" + "=".repeat(80));
    console.log("结构化输出已生成");
    console.log("=".repeat(80));
    console.log(JSON.stringify(finalAnalysis, null, 2));
  }
}

if (!finalAnalysis) {
  throw new Error("未获取到结构化输出 structuredResponse");
}

console.log("\n" + "=".repeat(80));
console.log("最终结构化视觉分析报告");
console.log("=".repeat(80));

console.log(`\n【图片文件名】\n${finalAnalysis.file_name}\n`);
console.log(`【主体内容描述】\n${finalAnalysis.subject_description}\n`);
console.log(`【风格氛围】\n${finalAnalysis.atmosphere_vibe}\n`);

console.log("【视觉细节列表】");
finalAnalysis.visual_details.forEach((detail, index) => {
  console.log(`  ${index + 1}. ${detail}`);
});

console.log(`\n【质量评分】\n${finalAnalysis.image_quality_score}\n`);
console.log(`【视觉锚点】\n${finalAnalysis.highlight_feature}\n`);

function maskBase64ImageContent(content: unknown) {
  if (typeof content !== "string") {
    return content;
  }

  return content.replace(
    /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g,
    "[图片 Base64 内容已省略]",
  );
}
```

---

## 5. 为什么主流程推荐用 `invoke`，不是 `stream`

`lesson2.ts` 当前用了 `stream` 来观察过程，这适合教学展示工具调用轨迹。

但这个多模态示例的目标是：

```text
稳定拿到 ImageAnalysis 结构化结果
```

所以主流程应该优先用：

```ts
const result = await imageAnalyst.invoke(...);
const analysis = result.structuredResponse;
```

如果想课堂展示 Agent 执行轨迹，可以再加一个 streaming 版本。但主实现不要依赖 stream 读取最终结构化结果。

---

## 6. 需要注意的事实

当前 `AliyunQwenChatModel` 对“工具返回图片 base64”的支持比较完整：

- tool message 中出现 `data:image/...;base64,...`
- wrapper 会把它转成模型需要的 `image_url`
- 并设置 `useImageModel = true`

但如果直接把图片作为 human message content block 传进去，例如：

```ts
{
  role: "user",
  content: [
    { type: "text", text: "分析这张图" },
    { type: "image", data: "...", mimeType: "image/jpeg" },
  ],
}
```

当前 wrapper 虽然能转换图片块，但不一定会自动把 `model` 切到 `imageModel`。所以在不改模型封装的前提下，最稳妥的方式就是：**沿用 CrewAI 思路，实现本地图片工具，让工具返回 base64。**

---

## 7. 和 `lesson2-implementation.md` 的关系

`docs/lesson2-implementation.md` 的核心迁移思路依然适用：

```text
Pydantic → Zod
Agent role/goal/backstory → systemPrompt
Task description → user message
output_pydantic → responseFormat
crew.kickoff → agent.invoke
```

但这节课比 lesson2 多了一个关键能力：

```text
本地图片 → Base64 → 多模态模型输入
```

所以这节的最小新增点就是：

```text
src/tools/add-image-tool-local.ts
```

其余部分继续复用：

```ts
import { createAgent } from "langchain";
import { AliyunQwenChatModel } from "../llm/aliyun-qwen-chat-model";
import { saveIntermediateProductTool } from "../tools/intermediate-tool";
```

---

## 8. 运行方式

按照项目约定使用 Bun：

```sh
bun run src/course_01/lesson4.ts
```

前提是 `.env` 中存在：

```env
QWEN_API_KEY=...
QWEN_API_BASE=...
```

并且图片存在于：

```text
src/course_01/20260202161329_150_6.jpg
```

---

## 9. 建议落地文件

如果要直接落地实现，建议新增两个文件：

```text
src/tools/add-image-tool-local.ts
src/course_01/lesson4.ts
```

并把 `lesson4.ts` 做成和 `m2l6_agent.py` 一一对应的多模态视觉分析示例。
