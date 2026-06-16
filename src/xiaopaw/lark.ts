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
});
wsClient.start({
  eventDispatcher: new Lark.EventDispatcher({}).register({
    // 处理「接收消息」事件，事件类型为 im.message.receive_v1
    "im.message.receive_v1": async (data) => {
      console.info("im.message.receive_v1", JSON.stringify(data, null, 2));
      const {
        message: { chat_id, content, chat_type, thread_id },
        sender,
      } = data;
      const sender_open_id = sender.sender_id?.open_id || "";
      // 示例操作：接收消息后，调用「发送消息」API 进行消息回复。
      await client.im.v1.message.create({
        params: {
          receive_id_type: "chat_id",
        },
        data: {
          receive_id: chat_id,
          content: JSON.stringify({ text: "⏳ 思考中，请稍候..." }),
          msg_type: "text",

          // content: Lark.messageCard.defaultCard({
          //   title: `回复： ${JSON.parse(content).text}`,
          //   content: "新年好",
          // }),
          // msg_type: "interactive",
        },
      });
    },
  }),
});
