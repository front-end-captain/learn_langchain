crewAI 中 agent 创建

``` python
agent = Agent(
    role="这是角色",
    goal="这是目标",
    backstory="这是背景",
    verbose=True,
    allow_delegation=False,
    tools=[IntermediateTool()],
    # 自定义 llm
    llm=AliyunLLM(
        model="qwen-plus",
        api_key=os.getenv("QWEN_API_KEY"),
        region="cn",
    ),
)
```

对应到 langchain 中创建 agent

``` typescript
const agent = createAgent({
  // 自定义 llm
  model: new AliyunLLM({
    model: "qwen3.7-plus",
    apiKey: process.env["QWEN_API_KEY"] ?? "",
    apiBase: process.env["QWEN_API_BASE"] ?? "",
  }),
  tools: [IntermediateTool],
  systemPrompt: `
你是: 这是角色。

你的目标：这是目标

你的背景：这是背景
`,
});

```

- `verbose=True` 在 LangChain 里没有完全等价字段。需要自定义实现。

- `allow_delegation=False` 在 LangChain 里默认就是没有多 Agent 委派。只要你不给它“调用其他 agent”的工具，它就不会委派。

- `IntermediateTool()` 在 CrewAI 里是工具实例；LangChain 里用 `tool(fn, { name, description, schema })` 定义。


crewAI 中的 agent 执行

``` python
result = content_strategist.kickoff([{"role": "user", "content": "我今天健身了，感觉很累，但是很开心。帮我设计一篇笔记"}])

```


对应到 langchain 中 agent 执行

``` typescript
const stream = await agent.stream(
  {
    messages: [
      {
        role: "user",
        content: "我今天健身了，感觉很累，但是很开心。帮我设计一篇笔记",
      },
    ],
  },
  {
    streamMode: "updates",
    version: "v2",
  },
);

for await (const chunk of stream) {
  // console.info("\nmessages", chunk.messages);

  const lastMessage = chunk.messages.at(-1);

  if (lastMessage instanceof HumanMessage) {
    console.info(
      lastMessage.getType().toUpperCase() + ": \n" + lastMessage.content + "\n",
    );
  }

  if (lastMessage instanceof ToolMessage) {
    console.info(
      lastMessage.getType().toUpperCase() + ": \n" + lastMessage.content + "\n",
    );
  }

  if (lastMessage instanceof AIMessage) {
    console.info(
      lastMessage.getType().toUpperCase() + ": \n" + lastMessage.content + "\n",
    );
    if (
      Array.isArray(lastMessage.tool_calls) &&
      lastMessage.tool_calls.length
    ) {
      console.info(
        "ToolCall: ",
        lastMessage.tool_calls?.map((t) => t.name).join(","),
        "\n",
      );
    }
  }
}
```

LangChain 里的消息主要有 4 种：

- SystemMessage 用来放系统指令
- HumanMessage 表示用户输入
- AIMessage 是模型输出
- ToolMessage 是工具调用结果

消息是 LangChain 里承载上下文的基本单位。

crewAI 中 Task 中创建

``` python
task = Task(
    description="""
    **任务要求**：
    1. 仔细分析视觉报告中的用户意图、图片质量和整体风格
    2. 基于 CES 算法和反漏斗模型，制定精准的内容策略
    3. 策略要具体可执行，不能泛泛而谈
    4. 使用 IntermediateTool 工具保存中间思考过程

    视觉分析报告如下：
    {visual_report}

    **重要提示**：
    - 必须基于输入的视觉分析报告进行分析
    - 报告包含：user_raw_intent、analyzed_images、overall_visual_summary
    - 策略要符合小红书平台的算法特点
    - 所有输出必须使用中文
    """,
    expected_output="一个完整的 ContentStrategyBrief 结构化输出，包含所有必填字段。",
    agent=content_strategist,
    output_pydantic=ContentStrategyBrief,
)


crew = Crew(
    agents=[agent],
    tasks=[task],
    process=Process.sequential,
    verbose=True,
)

result = crew.kickoff(inputs={"visual_report": visual_report.model_dump_json()})
```


对应到 langchain 中：
``` typescript
function task(visualReportJson: string): string {
  return `
任务要求：
1. 仔细分析视觉报告中的用户意图、图片质量和整体风格
2. 基于 CES 算法和反漏斗模型，制定精准的内容策略
3. 策略要具体可执行，不能泛泛而谈
4. 必须使用 intermediate_tool 工具保存中间思考过程

视觉分析报告如下：
${visualReportJson}

重要提示：
- 必须基于输入的视觉分析报告进行分析
- 报告包含：user_raw_intent、analyzed_images、overall_visual_summary
- 策略要符合小红书平台的内容分发和搜索流量特点
- 所有输出必须使用中文

期望输出：
一个完整的 ContentStrategyBrief 结构化输出，包含所有必填字段。
`;
}

const visualReportJson = JSON.stringify(visualReport);

const result = await agent.invoke({
  messages: [
    {
      role: "user",
      content: task(visualReportJson),
    },
  ],
});

const contentStrategyBrief = result.structuredResponse;
console.log(contentStrategyBrief);
```
