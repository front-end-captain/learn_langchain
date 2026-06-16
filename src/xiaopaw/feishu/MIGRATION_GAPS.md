# TypeScript Feishu SDK 遗漏内容检查报告

## 对比基准
Python `xiaopow/feishu/` 目录下的 4 个模块：
- `listener.py` - WebSocket 监听
- `sender.py` - 消息发送
- `downloader.py` - 附件下载
- `session_key.py` - routing_key 解析

## 遗漏内容清单

### 1. Bot 入群事件处理 ⚠️

**Python 实现：**
- `listener.py` 处理 `im.chat.member.bot.added_v1` 事件
- 用于白名单控制或发送欢迎消息
- 获取 `chat_id` 和 `group_name`

**TypeScript 文档：** 未提及

**应补充：**
```typescript
eventDispatcher: new Lark.EventDispatcher({}).register({
  "im.chat.member.bot.added_v1": async (data) => {
    // data.chat_id, data.name
    // 用于白名单控制或欢迎消息
  },
})
```

---

### 2. Post 富文本解析逻辑 ⚠️

**Python 实现：**
- `listener.py._extract_post_text()` 解析飞书 post 消息
- 提取 `zh_cn.title` 和 `zh_cn.content` 中 `tag="text"` 的文本

**TypeScript 文档：** 未涉及

**Post 消息结构：**
```json
{
  "zh_cn": {
    "title": "标题（可选）",
    "content": [
      [{"tag": "text", "text": "第一段"}, {"tag": "a", ...}],
      [{"tag": "text", "text": "第二段"}]
    ]
  }
}
```

**应补充解析逻辑（如需支持 post 消息）：**
```typescript
function extractPostText(data: any): string {
  const node = data.zh_cn || data;
  const title = node.title || "";
  const rawContent = node.content || [];

  if (!Array.isArray(rawContent)) return "";

  const paragraphTexts = rawContent.map((paragraph: any[]) => {
    if (!Array.isArray(paragraph)) return "";
    const words = paragraph
      .filter((elem: any) => elem.tag === "text")
      .map((elem: any) => elem.text || "");
    return words.join(" ");
  });

  const body = paragraphTexts.join(" ");
  return title ? `${title}\n${body}`.trim() : body.trim();
}
```

---

### 3. 重试机制 ⚠️

**Python 实现：**
- `sender.py` 实现指数退避重试
- `max_retries=3`, `backoff=(1, 2, 4)` 秒

**TypeScript 文档：** 未展示

**应补充：**
```typescript
async function retry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  backoff: number[] = [1000, 2000, 4000]
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === maxRetries - 1) throw e;
      const delay = backoff[Math.min(i, backoff.length - 1)];
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Retry failed"); // TypeScript 类型守卫
}

// 使用示例
await retry(() =>
  client.im.v1.message.create({
    params: { receive_id_type: "chat_id" },
    data: { receive_id: "...", msg_type: "text", content: '...' },
  })
);
```

---

### 4. `patch` vs `update` 的区别 ⚠️

**Python 使用：**
- 仅使用 `patch` 更新卡片消息

**TypeScript 文档：**
- 同时展示了 `update` 和 `patch`，但未说明区别

**区别说明：**
| API | 用途 | Python 使用 |
|-----|------|-------------|
| `client.im.v1.message.update()` | 编辑**文本/富文本**消息 | ❌ 未使用 |
| `client.im.v1.message.patch()` | 编辑**卡片**消息 | ✅ 使用 |

**应补充说明：**
```typescript
// 更新文本/富文本消息
client.im.v1.message.update({ ... });

// 更新卡片消息
client.im.v1.message.patch({ ... });
```

---

### 5. `uuid` 幂等用途说明 ⚠️

**Python 实现：**
- `uuid` 用于消息去重幂等

**TypeScript 文档：** 标注为"选填"但未说明用途

**应补充说明：**
```typescript
// uuid: 可选，用于幂等去重。相同 uuid 的重复请求会被服务端忽略，防止消息重复发送
data: {
  receive_id: "...",
  msg_type: "text",
  content: '{"text":"..."}',
  uuid: "每次调用前更换，如 a0d69e20-1dd1-458b-k525-dfeca4015204",
}
```

---

### 6. WebSocket 日志级别生产配置 ⚠️

**Python 实现：**
- 生产使用 `LogLevel.INFO`

**TypeScript 文档：**
- 示例使用 `LoggerLevel.debug`（开发用）

**应补充说明：**
```typescript
const wsClient = new Lark.WSClient({
  loggerLevel: Lark.LoggerLevel.info, // 生产环境
  // loggerLevel: Lark.LoggerLevel.debug, // 开发环境
});
```

---

### 7. `disableTokenCache` 推荐设置 ⚠️

**Python 实现：**
- SDK 自动管理 token

**TypeScript 文档：**
- 提及配置选项但未说明推荐设置

**应补充说明：**
```typescript
// disableTokenCache: false（默认）- SDK 自动管理租户 token 的获取与刷新，推荐用于生产环境
// disableTokenCache: true - 需手动调用 lark.withTenantToken("token") 传递 token，适用于自定义 token 管理场景
const wsClient = new Lark.WSClient({
  disableTokenCache: false, // 推荐默认值
});
```

---

### 8. 附件下载 `type` 参数说明 ⚠️

**Python 实现：**
- 下载时传入 `attachment.msg_type`（`image` / `file`）

**TypeScript 文档：**
- 示例只展示 `type: 'image'`

**应补充说明：**
```typescript
client.im.v1.messageResource.get({
  params: {
    type: 'image', // 或 'file' / 'video' / 'audio'
  },
  path: {
    message_id: "...",
    file_key: '...',
  }
}).then(res => {
  res.writeFile(`output.png`); // 保存到本地
});
```

---

### 9. routing_key 解析规则 ⚠️

**Python 实现：**
- `session_key.py` 定义路由规则

**TypeScript 文档：** 未提及

**应补充说明：**
```typescript
// 飞书消息路由规则
type RoutingKey =
  | `p2p:${string}`    // 单聊: p2p:{open_id}
  | `group:${string}`  // 群聊: group:{chat_id}
  | `thread:${string}:${string}`; // 话题: thread:{chat_id}:{thread_id}

function resolveRoutingKey(
  chatType: string,
  senderId: string,
  chatId: string,
  threadId?: string,
): RoutingKey {
  if (chatType === "p2p") {
    return `p2p:${senderId}`;
  }
  if (threadId) {
    return `thread:${chatId}:${threadId}`;
  }
  return `group:${chatId}`;
}
```

---

## 按重要性排序

| # | 遗漏项 | 重要性 | 建议优先级 |
|---|--------|--------|-----------|
| 1 | Bot 入群事件 `im.chat.member.bot.added_v1` | 🔴 高 | P0 |
| 2 | Post 富文本解析逻辑 | 🟡 中 | P1 |
| 3 | 重试机制 | 🟡 中 | P1 |
| 4 | `patch` vs `update` 区别说明 | 🟡 中 | P1 |
| 5 | `uuid` 幂等用途说明 | 🟢 低 | P2 |
| 6 | WebSocket 日志级别生产配置 | 🟢 低 | P2 |
| 7 | `disableTokenCache` 推荐设置 | 🟢 低 | P2 |
| 8 | 附件下载 `type` 参数说明 | 🟢 低 | P2 |
| 9 | routing_key 解析规则 | 🟢 低 | P2 |