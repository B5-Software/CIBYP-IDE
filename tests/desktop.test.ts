import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { BackendClient } from "../shared/client";
const source = process.env.CIBYP_SOURCE;
test(
  "IDE client talks to the real desktop BackendServer RPC and WebSocket implementation",
  {
    skip:
      !source ||
      !existsSync(resolve(source, "src/main/core/backend-server.js")),
  },
  async (t) => {
    const require = createRequire(resolve(source!, "package.json"));
    const { BackendServer } = require("./src/main/core/backend-server");
    const { createEventBus } = require("./src/main/core/event-bus");
    const token = "d".repeat(64),
      bus = createEventBus(),
      turns: any[] = [];
    const server = new BackendServer({
      eventBus: bus,
      token,
      dispatch: async ({ method, args }: any) => {
        if (method === "snapshot")
          return { sessions: [], views: {}, pid: process.pid };
        if (method === "submitMessage") {
          turns.push(args);
          return { ok: true, accepted: true };
        }
        throw new Error("Unknown method");
      },
    });
    const address = await server.start();
    t.after(() => server.stop());
    const client = new BackendClient({
      ...address,
      token,
      local: true,
      pid: process.pid,
    });
    t.after(() => client.close());
    const received: any[] = [];
    client.onEvent((e) => received.push(e));
    await client.connect();
    await client.request("submitMessage", "ide-test", "hello", []);
    assert.equal(turns.length, 1);
    await new Promise((r) => setTimeout(r, 50));
    bus.publish("agent:session-event", {
      type: "status",
      key: "ide-test",
      status: "running",
    });
    for (
      let i = 0;
      i < 100 && !received.some((e) => e.payload?.status === "running");
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(received.some((e) => e.payload?.status === "running"));
  },
);
