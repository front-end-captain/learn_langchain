/**
Intermediate Tool - 中间结果保存工具

用于在 Agent 执行过程中保存中间的思考产物，支持 Agent 的"慢思考"模式。

功能特点：
- 支持任意类型的输入（字符串、列表、字典等）
- 自动类型转换：将各种类型转换为字符串格式
- 简单易用：Agent 可以直接调用，无需关心类型转换

使用场景：
- Agent 需要分步骤思考时，保存中间结果
- Agent 需要记录思考过程时，保存思考产物
- Agent 需要传递复杂数据结构时，保存结构化数据

学习要点：
- 工具设计：如何设计简单易用的辅助工具
- 类型转换：如何处理不同类型的输入
- Agent 辅助：如何通过工具增强 Agent 的能力
*/

import { tool } from "@langchain/core/tools";
import * as z from "zod";

/**
 * 将任意类型的输入转换为字符串。
 *
 * 转换规则与 Python 版本保持一致：
 * - 字符串：直接返回
 * - 数组：使用换行符连接每个元素
 * - 对象：转换为 JSON 字符串，保留中文可读性
 * - 其他类型：使用 String() 转换
 */
export function convertIntermediateProductToString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join("\n");
  }

  if (value !== null && typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

export const intermediateToolSchema = z.object({
  intermediate_product: z.preprocess(
    convertIntermediateProductToString,
    z
      .string()
      .describe(
        [
          "中间思考产物，需要保存的内容。",
          "支持任意类型：字符串、列表、字典等，会自动转换为字符串格式。",
          "例如：列表 ['item1', 'item2'] 会自动转换为 'item1\\nitem2'。",
        ].join(""),
      ),
  ),
});

export const saveIntermediateProductTool = tool(
  (input) => {
    // LangChain 会先通过 schema 的 preprocess 将输入统一转换为字符串。
    void input.intermediate_product;

    return "中间结果已保存， 可以进行下一步Thought";
  },
  {
    name: "Save_Intermediate_Product_Tool",
    description: [
      "A tool that can be used to save intermediate thinking products during agent execution.",
      "\n\n",
      "✅ Supports any input type (string, list, dict, etc.) and automatically converts to string format. ",
      "You can pass lists, dictionaries, or any other type directly - no need to convert manually.",
      "\n\n",
      "Examples: ",
      "- String: 'my text' → saved as 'my text'",
      "- List: ['item1', 'item2'] → saved as 'item1\\nitem2'",
      "- Dict: {'key': 'value'} → saved as JSON string",
    ].join(""),
    schema: intermediateToolSchema,
  },
);
