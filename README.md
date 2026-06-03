# learn_langchain

一个用 Bun + TypeScript Go 原生预览版（`tsgo`）创建的 LangChain 学习项目。

## 技术栈

- Bun：运行时、包管理器、脚本执行器
- TypeScript Go native preview：通过 `@typescript/native-preview` 提供 `tsgo`
- TypeScript 严格类型检查：`strict` 及一组更严格的 `no*` 检查均已开启
- LangChain：`langchain`、`@langchain/core`、`@langchain/openai`

## 安装依赖

```bash
bun install
```

## 运行示例

```bash
bun run start
```

当前示例使用 `FakeListChatModel`，不需要配置 API Key，适合先学习 LangChain 的核心抽象和 LCEL 管道。

## 类型检查

```bash
bun run check
```

`check` 脚本实际执行：

```bash
tsgo --noEmit -p tsconfig.json
```

## 后续学习方向

1. 把 `FakeListChatModel` 替换为 `ChatOpenAI`，学习真实模型调用。
2. 继续学习 PromptTemplate、OutputParser、Runnable、Tool、Retriever 等核心组件。
3. 给每个学习主题添加一个独立示例文件，并用 `bun run <file>` 运行。
