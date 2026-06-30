# Lesson 7: LangGraph Multi-Agent Workflow

本示例用 LangGraph TypeScript 复刻 `crewai_mas_demo/m1l3/m1l3_multi_agent.py` 的多 Agent 调研报告流程。

核心思想不是把 CrewAI 的 `Agent`、`Task`、`Crew` 类名逐个翻译，而是把协作关系还原成三个基础元素：

- **状态**：当前工作流已经知道什么。
- **节点**：每一步由哪个角色完成什么工作。
- **边**：工作流下一步应该流向哪里。

## Graph 设计

CrewAI 示例里只有两个显式 Task：

1. `task_plan`：Researcher 生成研究步骤和报告大纲。
2. `task_write`：Writer 根据上游 context 写报告，并在执行过程中委托 Searcher 和 Editor。

LangGraph 版本把第二个 Task 中隐藏的委托过程展开成显式节点：

```text
START
  ↓
plan
  ↓
search_step
  ↓
write_step
  ↓
review_step
  ↓
revise_step
  ↓
是否还有研究步骤？
  ├─ 有 → search_step
  └─ 无 → integrate_final
             ↓
          review_final
             ↓
          revise_final
             ↓
            END
```

这样做的好处是：流程不再只依赖 Writer 的 prompt 自觉执行，而是由图结构保证每个步骤都会经历搜索、写作、审核和修改。

## 状态设计

`ReportState` 是整个工作流的共享上下文。每个节点读取当前状态，完成自己的工作后返回一小段 state patch，由 LangGraph 合并进全局状态。

关键字段如下：

| 字段 | 作用 |
|------|------|
| `topic` | 用户输入的研究主题 |
| `plan` | Researcher 生成的完整研究计划 |
| `steps` | 从研究计划中得到的步骤数组 |
| `currentStepIndex` | 当前正在处理第几个研究步骤 |
| `currentSearchResult` | Searcher 针对当前步骤收集到的资料 |
| `currentStepDraft` | Writer 生成的当前步骤初稿 |
| `currentStepReview` | Editor 对当前步骤初稿的审核意见 |
| `completedStepReports` | 已经审核并修改完成的步骤报告集合 |
| `finalDraft` | Writer 整合出的最终报告草稿 |
| `finalReview` | Editor 对最终报告的审核意见 |
| `finalReport` | 最终修改后的 Markdown 报告 |
| `outputFile` | 最终报告写入的文件路径 |

其中 `completedStepReports` 使用 reducer 追加结果：

```ts
completedStepReports: Annotation<StepReport[], StepReport[]>({
  reducer: (left, right) => left.concat(right),
  default: () => [],
})
```

这表示每完成一个步骤，节点只需要返回当前步骤报告：

```ts
return {
  completedStepReports: [revisedReport],
  currentStepIndex: state.currentStepIndex + 1,
};
```

LangGraph 会把新的步骤报告追加到已有数组中，而不是覆盖历史结果。

## 节点职责

| 节点 | 角色 | 职责 |
|------|------|------|
| `plan` | Researcher | 分析任务，生成研究计划、步骤和报告大纲 |
| `search_step` | Searcher | 围绕当前步骤搜索资料，输出可追溯证据 |
| `write_step` | Writer | 根据搜索资料撰写当前步骤报告 |
| `review_step` | Editor | 审核当前步骤报告，只给修改意见 |
| `revise_step` | Writer | 根据审核意见修改步骤报告，并推进步骤索引 |
| `integrate_final` | Writer | 整合所有步骤报告，生成最终报告草稿 |
| `review_final` | Editor | 审核最终报告草稿 |
| `revise_final` | Writer | 根据最终审核意见修改报告，并写入文件 |

## 边与循环

普通边表达固定顺序：

```ts
.addEdge("search_step", "write_step")
.addEdge("write_step", "review_step")
.addEdge("review_step", "revise_step")
```

条件边表达循环控制：

```ts
.addConditionalEdges("revise_step", routeAfterStep, [
  "search_step",
  "integrate_final",
])
```

`routeAfterStep` 根据 `currentStepIndex` 判断下一步：

- 如果还有未处理步骤，回到 `search_step`。
- 如果所有步骤都完成，进入 `integrate_final`。

这对应 CrewAI 示例中 Writer 在 `task_write` 内部“逐步研究、逐步审核、最终整合”的隐式循环。

## 与 CrewAI 示例的映射

| CrewAI 概念 | LangGraph 实现 |
|-------------|----------------|
| `Researcher Agent` | `plan` 节点中的 Researcher Agent |
| `Searcher Agent` | `search_step` 节点中的 Searcher Agent |
| `Writer Agent` | `write_step`、`revise_step`、`integrate_final`、`revise_final` 节点中的 Writer Agent |
| `Editor Agent` | `review_step`、`review_final` 节点中的 Editor Agent |
| `task_plan` | `plan` 节点 |
| `task_write` | 多个显式节点组成的报告生产子流程 |
| `context=[task_plan]` | `ReportState.plan` 和 `ReportState.steps` |
| `Process.sequential` | `addEdge` 定义的固定顺序 |
| `allow_delegation=True` | 显式图节点和边，而不是隐藏委托 |

## 设计取舍

这个版本刻意没有把 Searcher 和 Editor 包装成 Writer 可调用的工具。原因是课程目标是展示 LangGraph 的价值：把协作过程显式建模。

如果把 Searcher / Editor 做成 Writer 的工具，代码会更接近 CrewAI 的 delegation 风格，但搜索、审核、修改这些关键阶段又会重新隐藏到 Writer 的 agent loop 里，不利于观察状态流转，也不利于后续加入重试、人工确认、缓存或断点恢复。
