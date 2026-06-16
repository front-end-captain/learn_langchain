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


client.im.v1.messageResource.get({
  params: {
    type: 'image'
  },
  path: {
    message_id: "om_x100b6c23e4a8a4acc213560ef5afc3f",
    file_key: 'img_v3_0212o_5ff2ba5e-9975-45f0-8155-e5ba9505f66g'
  }
}).then(res => {
  res.writeFile(`foo.png`);
}).catch(e => {
  console.error(JSON.stringify(e.response.data, null, 4));
});

