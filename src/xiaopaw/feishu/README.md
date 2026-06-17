- 创建长连接客户端和事件处理

> 文档地址 https://open.feishu.cn/document/server-side-sdk/nodejs-sdk/handling-events 参考 ‘方式一：使用长连接接收事件’ 章节

```typescript
import * as Lark from "@larksuiteoapi/node-sdk";

const client = new Lark.Client({
  appId: process.env["LARK_APP_ID"],
  appSecret: process.env["LARK_APP_SECRET"],
  loggerLevel: Lark.LoggerLevel.info,
});

const wsClient = new Lark.WSClient({
  appId: process.env["LARK_APP_ID"],
  appSecret: process.env["LARK_APP_SECRET"],
  loggerLevel: Lark.LoggerLevel.debug,
  // disableTokenCache为true时，SDK不会主动拉取并缓存token，这时需要在发起请求时，调用lark.withTenantToken("token")手动传递
  // disableTokenCache为false时，SDK会自动管理租户token的获取与刷新，无需使用lark.withTenantToken("token")手动传递token
  disableTokenCache: false,
});
wsClient.start({
  eventDispatcher: new Lark.EventDispatcher({}).register({
    // 处理「接收消息」事件，事件类型为 im.message.receive_v1
    "im.message.receive_v1": async (data) => {
      // 示例操作：接收消息后，调用「发送消息」API 进行消息回复。
      await client.im.v1.message.create({
        params: {
          receive_id_type: "chat_id",
        },
        data: {
          receive_id: data.message.chat_id,
          content: JSON.stringify({ text: "⏳ 思考中，请稍候..." }),
          msg_type: "text",
        },
      });
    },
    // 无需处理 'im.chat.member.bot.added_v1' 事件，优先级较低
  }),
});
```

- 发送消息

> 向指定用户或者群聊发送消息。支持发送的消息类型包括文本、富文本、卡片、群名片、个人名片、图片、视频、音频、文件以及表情包等
> 文档地址：https://open.feishu.cn/document/server-docs/im-v1/message/create

```typescript
// 向指定用户发送消息(p2p)
client.im.v1.message
  .create({
    params: {
      receive_id_type: "open_id",
    },
    data: {
      receive_id: "ou_xxx", // open_id
      msg_type: "text", // 消息类型
      content: '{"text":"私聊消息"}', // 消息内容
      uuid: "选填，每次调用前请更换，如a0d69e20-1dd1-458b-k525-dfeca4015204",
    },
  })
  .then((res) => {
    console.log(res);
  })
  .catch((e) => {
    console.error(JSON.stringify(e.response.data, null, 4));
  });

// 向指定群发送消息
client.im.v1.message
  .create({
    params: {
      receive_id_type: "chat_id",
    },
    data: {
      receive_id: "oc_xxx", // chat_id
      msg_type: "text", // 消息类型
      content: '{"text":"发送群聊消息"}', // 消息内容
    },
  })
  .then((res) => {
    console.log(res);
  })
  .catch((e) => {
    console.error(JSON.stringify(e.response.data, null, 4));
  });
```

- 发送卡片消息

> 向指定用户或者群聊发送卡片消息
> 文档地址：https://open.feishu.cn/document/server-docs/im-v1/message/create

```typescript
client.im.v1.message
  .create({
    params: {
      receive_id_type: "chat_id",
    },
    data: {
      receive_id: "oc_xxx", // chat_id
      // 卡片内容，这里使用 sdk 提供的默认卡片样式，也可以自定义卡片样式，参考文档：https://open.feishu.cn/document/server-docs/im-v1/message-card/overview
      content: Lark.messageCard.defaultCard({
        title: `回复： ${JSON.parse(content).text}`,
        content: "新年好",
      }),
      msg_type: "interactive", // 消息类型为‘卡片’
      uuid: "选填，每次调用前请更换，如a0d69e20-1dd1-458b-k525-dfeca4015204",
    },
  })
  .then((res) => {
    console.log(res);
  })
  .catch((e) => {
    console.error(JSON.stringify(e.response.data, null, 4));
  });
```

- 回复消息

> 回复指定消息。回复的内容支持文本、富文本、卡片、群名片、个人名片、图片、视频、文件等多种类型
> 文档地址：https://open.feishu.cn/document/server-docs/im-v1/message/reply

```typescript
client.im.v1.message
  .reply({
    path: {
      message_id: "om_xxx", // 待回复的消息ID
    },
    data: {
      content: '{"text":"test content"}', // 回复内容
      msg_type: "text", // 消息类型
      reply_in_thread: true, // 是否以话题形式回复。取值为 true 时将以话题形式回复。
      uuid: "选填，每次调用前请更换，如a0d69e20-1dd1-458b-k525-dfeca4015204",
    },
  })
  .then((res) => {
    console.log(res);
  })
  .catch((e) => {
    console.error(JSON.stringify(e.response.data, null, 4));
  });
```

- 更新/更新消息

> 编辑已发送的消息内容，支持编辑文本、富文本消息。不支持编辑卡片消息
> 文档地址：https://open.feishu.cn/document/server-docs/im-v1/message/update

```typescript
client.im.v1.message
  .update({
    path: {
      message_id: "om_xxx", // 消息ID
    },
    data: {
      content: '{"text":"test content"}',
      msg_type: "text",
      reply_in_thread: true,
      uuid: "选填，每次调用前请更换，如a0d69e20-1dd1-458b-k525-dfeca4015204",
    },
  })
  .then((res) => {
    console.log(res);
  })
  .catch((e) => {
    console.error(JSON.stringify(e.response.data, null, 4));
  });
```

- 更新/编辑卡片消息

> 编辑已发送的消息卡片
> 文档地址：https://open.feishu.cn/document/server-docs/im-v1/message-card/patch

```typescript
client.im.v1.message
  .patch({
    path: {
      message_id: "om_xxx", // 消息ID
    },
    data: {
      content: Lark.messageCard.defaultCard({
        title: `回复：`,
        content: "新春快乐",
      }),
    },
  })
  .then((res) => {
    console.log(res);
  })
  .catch((e) => {
    console.error(JSON.stringify(e.response.data, null, 4));
  });
```

- 获取消息中的资源文件

> 获取指定消息内包含的资源文件，包括音频、视频、图片和文件。成功调用后，返回二进制文件流下载文件
> 文档地址：https://open.feishu.cn/document/server-docs/im-v1/message/get-2

```typescript
client.im.v1.messageResource
  .get({
    params: {
      type: "image", // image: 获取消息中的图片或富文本消息中的图片; file: 获取消息中的文件、音频、视频
    },
    path: {
      message_id: "om_xxx",
      file_key: "img_v3_0212o_5ff2ba5e-9975-45f0-8155-e5ba9505f66g",
    },
  })
  .then((res) => {
    // 示例：写入文档到本地
    res.writeFile(`foo.png`);
  })
  .catch((e) => {
    console.error(JSON.stringify(e.response.data, null, 4));
  });
```
