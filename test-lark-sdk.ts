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
    "im.message.receive_v1": async (data) => {
      console.info("im.message.receive_v1", JSON.stringify(data, null, 2));
    },
  }),
});

client.im.v1.messageResource
  .get({
    params: {
      type: "image",
    },
    path: {
      message_id: "om_x100b6c158a06f8b8c2686f54901a00",
      file_key: "file_v3_0012o_9877d71d-1ff8-47f0-af16-504e116aa15g",
    },
  })
  .then((res) => {
    console.info("res", res);
    // 示例：写入文档到本地
    // res.writeFile(`foo.png`);
  })
  .catch((e) => {
    console.error(JSON.stringify(e.response.data, null, 4));
  });
