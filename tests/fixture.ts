import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
export async function fixture(
  options: { dropFirstAcknowledgement?: boolean; resetOnce?: boolean } = {},
) {
  const token = "b".repeat(64),
    calls: any[] = [],
    sessions: any[] = [],
    requests = new Map<string, any>();
  let sequence = 0;
  let dropped = false,
    reset = false;
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/health")
      return res.end(
        JSON.stringify({ ok: true, service: "cibyp-backend", protocol: 1 }),
      );
    let data = "";
    for await (const chunk of req) data += chunk;
    const body = data ? JSON.parse(data) : {};
    if (req.url === "/api/login") {
      if (body.password !== "fixture-password") {
        res.statusCode = 401;
        return res.end('{"error":"Invalid password"}');
      }
      return res.end(JSON.stringify({ ok: true, token }));
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.statusCode = 401;
      return res.end('{"error":"Authentication required"}');
    }
    if (requests.has(body.id))
      return res.end(JSON.stringify(requests.get(body.id)));
    calls.push(body);
    if (req.url === "/remote/v2/rpc")
      return res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.method === "fixture.wrongId" ? "wrong" : body.id,
          ...(body.method === "device.page"
            ? {
                result: {
                  items: [
                    { id: "board", label: "LED", online: true, toolCount: 2 },
                  ],
                  total: 1,
                  nextOffset: null,
                },
              }
            : {
                error: {
                  code: 1003,
                  message: "Denied",
                  data: { reason: "FORBIDDEN" },
                },
              }),
        }),
      );
    const args = body.args || [];
    let result: any = { ok: true };
    const get = (key: string) => sessions.find((s) => s.key === key);
    const view = (key: string) => ({
      session: get(key),
      messages: [
        {
          role: "user",
          content: "Review the current selection and explain the issue.",
          attachments: [
            { name: "workspace.ts-selection.txt", type: "text/plain" },
          ],
        },
        {
          role: "assistant",
          content:
            "The selected function needs to handle an empty result before reading its properties.\n\n| Case | Result |\n| --- | --- |\n| Match found | Return the entry |\n| Empty list | Return `undefined` |\n\n```typescript\nconst entry = items.find(matches);\nif (!entry) return undefined;\nreturn entry.value;\n```\n\nYou can review the suggestion in the editor before making a change.",
        },
      ],
      stats: { context: { used: 800, max: 32000 } },
      llmOverride: { apiKey: "MUST-NOT-REACH-WEBVIEW" },
      systemPrompt: "PRIVATE PROMPT",
      pendingInteraction: null,
    });
    switch (body.method) {
      case "snapshot":
        result = {
          sessions,
          views: Object.fromEntries(sessions.map((s) => [s.key, view(s.key)])),
          sequence,
          pid: process.pid,
          boot: { ready: true },
        };
        break;
      case "listSessions":
        result = sessions;
        break;
      case "createSession": {
        const s = {
          ...args[0],
          title: "Test conversation",
          status: "idle",
          profile: "default",
          busy: false,
          conversationId: randomUUID(),
        };
        sessions.push(s);
        result = s;
        break;
      }
      case "setWorkspace": {
        get(args[0]).workspacePath = args[1];
        result = { ok: true, workspacePath: args[1] };
        break;
      }
      case "initialize":
        result = view(args[0].key);
        break;
      case "getView":
        result = view(args[0]);
        break;
      case "getSessionDetails":
        result = view(args[0]);
        break;
      case "getStats":
        result = { context: { used: 800, max: 32000 } };
        break;
      case "listHistory":
        result = [];
        break;
      case "uploadAttachment":
        result = {
          name: args[1].name,
          path: `/workspace/${args[1].name}`,
          type: args[1].type,
        };
        break;
    }
    const value = { result };
    requests.set(body.id, value);
    if (
      options.dropFirstAcknowledgement &&
      !dropped &&
      body.method === "submitMessage"
    ) {
      dropped = true;
      res.destroy();
      return;
    }
    res.end(JSON.stringify(value));
  });
  const ws = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      socket.destroy();
      return;
    }
    ws.handleUpgrade(req, socket, head, (client) => {
      ws.emit("connection", client, req);
      if (options.resetOnce && !reset) {
        reset = true;
        client.send('{"type":"reset"}');
      }
      client.send('{"type":"connected"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port,
    url = `http://127.0.0.1:${port}`;
  return {
    url,
    token,
    calls,
    sessions,
    publish(channel: string, payload: unknown) {
      for (const client of ws.clients)
        if (client.readyState === WebSocket.OPEN)
          client.send(
            JSON.stringify({ sequence: ++sequence, channel, payload }),
          );
    },
    sockets: ws.clients,
    async close() {
      for (const client of ws.clients) client.terminate();
      ws.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
