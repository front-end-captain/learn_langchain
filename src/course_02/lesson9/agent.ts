import { AIMessage, createAgent } from "langchain";

import { AliyunQwenChatModel } from "../../llm/aliyun-qwen-chat-model";
import { saveIntermediateProductTool } from "../../tools/intermediate-tool";
import { createSkillLoaderTool } from "../../tools/skill-loader-tool";
import {
  createAgentUpdateEvent,
  createToolCallsEvent,
  getToolCalls,
  type AgentStreamEventHandler,
} from "../../helper/agent-stream";

const llm = new AliyunQwenChatModel({
  model: process.env["QWEN_MODEL"] ?? "qwen3.6-max-preview",
  apiKey: process.env["QWEN_API_KEY"] ?? "",
  apiBase: process.env["QWEN_API_BASE"] ?? "",
});

const systemPrompt = `
你是：skill使用助手总管",
你的目标：根据用户需求进行分析，拆解，分发任务，最终保证任务的完成",
你的背景：
你是skill使用助手总管，善于接收用户的需求，使用skill去完成。

你通常的工作思路包括：
1、你会先去理解用户需求，进行需求分析，将结果使用Save_Intermediate_Product_Tool记录；
2、当要完成任务有需要参考的type是reference的skill时，你需要使用skill_loader工具去加载对应skill；
3、你会规划步骤，生成子任务，使用Save_Intermediate_Product_Tool记录，每个子任务都要有明确的预期目标和足够的背景信息；
3、然后依次完成子任务，当子任务适合type是task的skill完成时，你会生成task_context并使用skill_loader工具，调用对应skill去完成；预期目标应该是结构化的json结果，你必须给子任务一个json schema，以便你确认执行情况和结果；
4、根据每次的子任务结果，你会去管理当前的步骤，如果出现偏差你可以进行重新规划，同样使用Save_Intermediate_Product_Tool记录；
5、最终你会将最终结果返回给用户。

行为边界：
你会尽量使用skill完成任务，而不是自行编造结果。
`;

export async function run(input: string, onEvent?: AgentStreamEventHandler) {
  const skillLoaderTool = await createSkillLoaderTool();

  const agent = createAgent({
    model: llm,
    systemPrompt,
    tools: [skillLoaderTool, saveIntermediateProductTool],
  });

  const stream = await agent.stream(
    {
      messages: [
        {
          role: "user",
          content: `
${input}

**输出要求**：
完整的任务执行报告，包含：
- 每个 Skill 的执行结果
- 最终输出文件路径
- 任务是否成功完成
`,
        },
      ],
    },
    { streamMode: "values" },
  );

  let finalMessageType: string | undefined;
  let message = "";

  for await (const chunk of stream) {
    const lastMessage = chunk.messages.at(-1);
    finalMessageType = lastMessage?.getType?.();

    onEvent?.(createAgentUpdateEvent(lastMessage));

    const toolCalls = getToolCalls(lastMessage);
    if (toolCalls.length > 0) {
      onEvent?.(createToolCallsEvent(toolCalls));
    }

    if (lastMessage instanceof AIMessage) {
      message = lastMessage.content as string;
    }
  }

  return { type: finalMessageType, message };
}
