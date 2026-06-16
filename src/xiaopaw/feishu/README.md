- 创建长连接客户端和事件处理
``` typescript
import * as Lark from "@larksuiteoapi/node-sdk";

const wsClient = new Lark.WSClient({
  appId: process.env["LARK_APP_ID"],
  appSecret: process.env["LARK_APP_SECRET"],
  loggerLevel: Lark.LoggerLevel.debug,
  // disableTokenCache为true时，SDK不会主动拉取并缓存token，这时需要在发起请求时，调用lark.withTenantToken("token")手动传递
  // disableTokenCache为false时，SDK会自动管理租户token的获取与刷新，无需使用lark.withTenantToken("token")手动传递token
  disableTokenCache: true,
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
  }),
});
```

- 发送消息
> 向指定用户或者群聊发送消息。支持发送的消息类型包括文本、富文本、卡片、群名片、个人名片、图片、视频、音频、文件以及表情包等

``` typescript
client.im.v1.message
  .create({
    params: {
      receive_id_type: "chat_id",
    },
    data: {
      receive_id: "ou_7d8a6e6df7621556ce0d21922b676706ccs",
      msg_type: "text",
      content: '{"text":"test content"}',
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
``` typescript
client.im.v1.message
  .reply({
    path: {
      message_id: "",
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
