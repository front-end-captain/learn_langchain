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

## XiaoPaw TypeScript 启动

XiaoPaw 入口位于 `src/xiaopaw/main.ts`。启动前先准备 `config.yaml`，可以使用环境变量占位：

```yaml
feishu:
  app_id: ${FEISHU_APP_ID}
  app_secret: ${FEISHU_APP_SECRET}
  allowed_chats: []
baidu:
  api_key: ${BAIDU_API_KEY}
data_dir: ./data
skills:
  local_dir: ./src/skills
sandbox:
  url: http://localhost:8022/mcp
  workspace_dir: /workspace
debug:
  enable_test_api: true
  test_api_host: 127.0.0.1
  test_api_port: 9090
```

必要环境变量：

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
export QWEN_API_KEY="sk-xxx"
export BAIDU_API_KEY="xxx" # 使用 baidu_search Skill 时需要
```

先启动 AIO-Sandbox：

```bash
docker compose -f sandbox-docker-compose.yaml up -d
```

再启动 XiaoPaw：

```bash
bun run src/xiaopaw/main.ts
```

也可以显式指定配置文件：

```bash
bun run src/xiaopaw/main.ts --config ./config.yaml
```

启动后：

- Prometheus metrics: `http://127.0.0.1:9100/metrics`
- TestAPI: `POST http://127.0.0.1:9090/api/test/message`，仅在 `debug.enable_test_api: true` 时启用。

TestAPI 冒烟请求：

```bash
curl -X POST http://127.0.0.1:9090/api/test/message \
  -H "Content-Type: application/json" \
  -d '{"routing_key":"p2p:ou_debug","content":"你好，小爪子","sender_id":"ou_debug"}'
```

### 备注
src/course_01/lesson6 -> crewai_mas_demo/m1l2
