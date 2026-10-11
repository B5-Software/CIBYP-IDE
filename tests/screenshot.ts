import WebSocket from "ws";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
export async function screenshot(name: string) {
  const port = process.env.CIBYP_SCREENSHOT_PORT;
  if (!port) return;
  const targets = (await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json()) as any[];
  const target = targets.find(
    (t) => t.type === "page" && /workbench/.test(t.url),
  );
  if (!target)
    throw new Error("VS Code renderer debugging target unavailable.");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const bytes = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Screenshot timed out"));
    }, 10000);
    ws.once("open", () =>
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Page.captureScreenshot",
          params: { format: "png" },
        }),
      ),
    );
    ws.on("message", (data) => {
      const value = JSON.parse(String(data));
      if (value.id === 1) {
        clearTimeout(timer);
        ws.close();
        if (value.error) reject(new Error(value.error.message));
        else resolve(value.result.data);
      }
    });
    ws.once("error", reject);
  });
  const directory = resolve(__dirname, "../docs/screenshots");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, name), Buffer.from(bytes, "base64"));
}
