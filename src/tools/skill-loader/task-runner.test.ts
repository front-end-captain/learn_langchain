import { describe, expect, it, mock } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { tool } from "@langchain/core/tools";
import * as z from "zod";
import {
  buildSkillAgentSystemPrompt,
  buildSkillTaskPrompt,
  defaultSubAgentRunner,
  runTaskSkill,
} from "./task-runner.ts";

const sandboxTool = tool(async () => "{}", {
  name: "sandbox_execute_code",
  description: "在沙盒中执行代码",
  schema: z.object({}),
});

describe("task-runner prompt builders", () => {
  it("builds a Sub-Agent system prompt with sandbox boundaries", () => {
    const prompt = buildSkillAgentSystemPrompt({
      skillName: "pdf",
      instructions: "PDF Skill instructions",
      sessionDir: "/workspace/sessions/session-1",
    });

    expect(prompt).toContain("PDF Skill 执行专家");
    expect(prompt).toContain("/workspace/sessions/session-1/uploads/");
    expect(prompt).toContain("/workspace/sessions/session-1/outputs/");
    expect(prompt).toContain("你没有名为 'pdf' 的直接工具");
    expect(prompt).toContain("browser_* 系列工具");
    expect(prompt).toContain("PDF Skill instructions");
  });

  it("builds a task prompt with explicit input and output paths", () => {
    const prompt = buildSkillTaskPrompt({
      taskContext: "读取 uploads/a.pdf，并输出 JSON",
      sessionDir: "/workspace/sessions/session-1",
    });

    expect(prompt).toContain("读取 uploads/a.pdf，并输出 JSON");
    expect(prompt).toContain("/workspace/sessions/session-1/uploads/");
    expect(prompt).toContain("/workspace/sessions/session-1/outputs/");
    expect(prompt).toContain("返回结果必须符合 task_context 中定义的 JSON schema");
  });
});

describe("runTaskSkill", () => {
  it("assembles MCP tools, Sub-Agent model, prompts and max iteration limit", async () => {
    const toolsProvider = mock(async (url: string) => {
      expect(url).toBe("http://sandbox.example/mcp");
      return [sandboxTool];
    });
    const subAgentRunner = mock(
      async ({
        tools,
        systemPrompt,
        taskPrompt,
        maxIter,
      }: Parameters<typeof defaultSubAgentRunner>[0]) => {
        expect(tools).toEqual([sandboxTool]);
        expect(systemPrompt).toContain("XLSX Skill 执行专家");
        expect(systemPrompt).toContain("/workspace/sessions/session-42/uploads/");
        expect(systemPrompt).toContain("sandbox_execute_code");
        expect(taskPrompt).toContain("分析表格并输出 JSON");
        expect(taskPrompt).toContain("/workspace/sessions/session-42/outputs/");
        expect(maxIter).toBe(7);
        return '{"errcode":0,"errmsg":"success"}';
      },
    );

    const result = await runTaskSkill({
      skillName: "xlsx",
      instructions: "XLSX Skill instructions",
      taskContext: "分析表格并输出 JSON",
      options: {
        sandboxMcpUrl: "http://sandbox.example/mcp",
        sessionId: "session-42",
        subAgentMaxIter: 7,
        subAgentChatModel: fakeModel(),
        mcpToolsProvider: toolsProvider,
        subAgentRunner,
      },
    });

    expect(result).toBe('{"errcode":0,"errmsg":"success"}');
    expect(toolsProvider).toHaveBeenCalledTimes(1);
    expect(subAgentRunner).toHaveBeenCalledTimes(1);
  });
});

describe("defaultSubAgentRunner", () => {
  it("returns the final agent message content", async () => {
    const model = fakeModel().respond(new AIMessage("执行完成"));

    const result = await defaultSubAgentRunner({
      model,
      tools: [],
      systemPrompt: "你是测试 Sub-Agent",
      taskPrompt: "完成任务",
      maxIter: 3,
    });

    expect(result).toBe("执行完成");
  });
});
