import { describe, expect, it } from "bun:test";

import { CaptureSender } from "./capture-sender.ts";

describe("CaptureSender", () => {
  it("captures send content by root id", async () => {
    const sender = new CaptureSender();
    const reply = sender.register("om_001");

    await sender.send("p2p:ou_user", "hello", "om_001");

    await expect(reply).resolves.toBe("hello");
  });

  it("returns a thinking card stub and captures updateCard", async () => {
    const sender = new CaptureSender();
    const reply = sender.register("om_001");

    await expect(sender.sendThinking("p2p:ou_user", "om_001")).resolves.toBe(
      "test-card-thinking-001",
    );
    await sender.updateCard("test-card-thinking-001", "final");

    await expect(reply).resolves.toBe("final");
  });

  it("does not capture sendText slash replies", async () => {
    const sender = new CaptureSender();
    const reply = sender.register("om_001");

    await sender.sendText("p2p:ou_user", "slash", "om_001");
    await sender.send("p2p:ou_user", "final", "om_001");

    await expect(reply).resolves.toBe("final");
  });

  it("throws when waiting for an unregistered message", () => {
    const sender = new CaptureSender();

    expect(() => sender.waitForReply("missing", 1)).toThrow("未注册");
  });

  it("cleans pending replies after wait timeout", async () => {
    const sender = new CaptureSender();
    const registered = sender.register("om_timeout");

    await expect(sender.waitForReply("om_timeout", 1)).rejects.toThrow(
      "等待回复超时: om_timeout",
    );
    await expect(registered).rejects.toThrow("等待回复超时: om_timeout");
    expect(() => sender.waitForReply("om_timeout", 1)).toThrow("未注册");
  });
});
