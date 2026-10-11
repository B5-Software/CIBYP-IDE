import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackendClient } from "../shared/client";
import { discover } from "../shared/discovery";
import { address, publicView } from "../shared/protocol";
import { contextPrompt } from "../shared/context";
import { fixture } from "./fixture";
const until = async (fn: () => boolean) => {
  const end = Date.now() + 5000;
  while (!fn()) {
    if (Date.now() > end) throw new Error("Timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
test("authenticated shared client connects, sends a turn, receives events and reconnects", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const c = new BackendClient({ ...f, local: true, pid: process.pid });
  t.after(() => c.close());
  const events: any[] = [];
  c.onEvent((e) => events.push(e));
  assert.equal((await c.connect()).pid, process.pid);
  await until(() => events.some((e) => e.connected));
  await c.request("submitMessage", "key", "hello", []);
  assert.equal(f.calls.filter((c) => c.method === "submitMessage").length, 1);
  f.publish("agent:session-event", {
    key: "key",
    type: "message",
    content: "response",
  });
  await until(() => events.some((e) => e.payload?.content === "response"));
  for (const socket of f.sockets) socket.close(1012, "Restart");
  await until(() => events.filter((e) => e.connected).length === 2);
  f.publish("agent:session-event", {
    key: "key",
    type: "status",
    status: "idle",
  });
  await until(() => events.some((e) => e.payload?.status === "idle"));
});
test("remote login and expiry fail explicitly without putting credentials in URLs", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const c = new BackendClient({ url: f.url, local: false, token: "" });
  t.after(() => c.close());
  await assert.rejects(c.login("wrong"), /Invalid password/);
  assert.equal(await c.login("fixture-password"), f.token);
  await c.connect();
  assert.ok(!c.url.includes(f.token));
  const events: any[] = [];
  c.onEvent((event) => events.push(event));
  await until(() => f.sockets.size > 0);
  for (const socket of f.sockets) socket.close(1008, "Session expired");
  await until(() =>
    events.some((event) => event.type === "authentication-required"),
  );
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(f.sockets.size, 0);
});

test("lost send acknowledgement is retried with the same ID and runs only once", async (t) => {
  const f = await fixture({ dropFirstAcknowledgement: true });
  t.after(() => f.close());
  const client = new BackendClient({ ...f, local: true });
  t.after(() => client.close());
  await client.request("submitMessage", "session", "Once only", []);
  assert.equal(f.calls.filter((c) => c.method === "submitMessage").length, 1);
});

test("an expired replay window refreshes snapshot and resumes live events", async (t) => {
  const f = await fixture({ resetOnce: true });
  t.after(() => f.close());
  const client = new BackendClient({ ...f, local: true });
  t.after(() => client.close());
  const events: any[] = [];
  client.onEvent((event) => events.push(event));
  await client.connect();
  await until(() => events.some((e) => e.type === "snapshot"));
  await until(() => events.filter((e) => e.connected).length >= 2);
  f.publish("agent:session-event", { type: "status", status: "ready" });
  await until(() => events.some((e) => e.payload?.status === "ready"));
  assert.equal(f.calls.filter((c) => c.method === "snapshot").length, 2);
});
test("discovery rejects non-loopback, stale processes, bad protocol and symbolic links", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cibyp-ide-discovery-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const row = {
    url: "http://127.0.0.1:12345",
    token: "a".repeat(64),
    pid: process.pid,
    protocol: 1,
  };
  const write = (id: string, value: unknown) =>
    writeFile(
      join(dir, `cibyp-backend-${id.repeat(24)}.json`),
      JSON.stringify(value),
      { mode: 0o600 },
    );
  await write("a", row);
  await write("b", { ...row, url: "https://evil.example" });
  await write("c", { ...row, pid: 999999999 });
  await write("d", { ...row, protocol: 2 });
  assert.equal((await discover(dir)).length, 1);
  if (process.platform !== "win32") {
    await symlink(
      join(dir, `cibyp-backend-${"a".repeat(24)}.json`),
      join(dir, `cibyp-backend-${"e".repeat(24)}.json`),
    );
    assert.equal((await discover(dir)).length, 1);
  }
});
test("remote URLs cannot leak credentials, downgrade encryption or silently change paths", () => {
  for (const url of [
    "http://example.com",
    "https://user:password@example.com",
    "https://example.com/prefix",
    "https://example.com?token=secret",
    "file:///tmp/foo",
  ])
    assert.throws(() => address(url));
  assert.equal(address("https://example.com/"), "https://example.com");
  assert.equal(address("http://127.0.0.1:3456"), "http://127.0.0.1:3456");
});
test("webview projection excludes provider secrets and system prompts; code context is bounded", () => {
  const view = publicView({
    session: { key: "test" },
    messages: [
      {
        role: "assistant",
        content: "hello",
        encrypted_reasoning: "ciphertext",
      },
    ],
    llmOverride: { apiKey: "SECRET" },
    systemPrompt: "PRIVATE",
  });
  assert.ok(!JSON.stringify(view).includes("SECRET"));
  assert.ok(!JSON.stringify(view).includes("PRIVATE"));
  assert.ok(!JSON.stringify(view).includes("ciphertext"));
  const prompt = contextPrompt({
    path: "x.ts",
    language: "ts",
    text: "a".repeat(40000),
    startLine: 1,
    endLine: 20,
    diagnostics: [{ line: 2, severity: "Error", message: "Undefined name" }],
  });
  assert.match(prompt, /Limited|limited/);
  assert.match(prompt, /Undefined name/);
  assert.ok(prompt.length < 33000);
});
