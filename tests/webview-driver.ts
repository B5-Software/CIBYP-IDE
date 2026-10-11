import WebSocket from "ws";

// Test-only CDP driver: exercises the installed webview, rather than a second UI implementation.
export async function webviewDriver() {
  const info = (await (
    await fetch(
      `http://127.0.0.1:${process.env.CIBYP_SCREENSHOT_PORT}/json/version`,
    )
  ).json()) as any;
  const socket = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let sequence = 0;
  const pending = new Map<
    number,
    {
      resolve(value: any): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  socket.on("message", (bytes) => {
    const message = JSON.parse(String(bytes)),
      request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  function rpc(
    method: string,
    params: any = {},
    sessionId?: string,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++sequence,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timed out: ${method}`));
        }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  const findDocument = `function find(d){if(d.querySelector('#input')&&d.querySelector('#messages'))return d;for(const f of d.querySelectorAll('iframe')){try{const result=find(f.contentDocument);if(result)return result;}catch{}}return null;}`;
  let selected: string | undefined;
  for (let attempt = 0; attempt < 30 && !selected; attempt++) {
    const { targetInfos } = await rpc("Target.getTargets");
    for (const target of targetInfos.filter((t: any) =>
      ["page", "iframe"].includes(t.type),
    )) {
      const { sessionId } = await rpc("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      });
      const result = await rpc(
        "Runtime.evaluate",
        {
          expression: `(()=>{${findDocument}return !!find(document)})()`,
          returnByValue: true,
        },
        sessionId,
      );
      if (result.result.value) {
        selected = sessionId;
        break;
      }
      await rpc("Target.detachFromTarget", { sessionId });
    }
    if (!selected) await new Promise((r) => setTimeout(r, 100));
  }
  if (!selected) {
    socket.close();
    throw new Error("CIBYP webview document unavailable");
  }
  return {
    async evaluate(expression: string) {
      const result = await rpc(
        "Runtime.evaluate",
        {
          expression: `(()=>{${findDocument}const d=find(document);${expression}})()`,
          returnByValue: true,
          awaitPromise: true,
        },
        selected,
      );
      if (result.exceptionDetails)
        throw new Error(result.exceptionDetails.text);
      return result.result.value;
    },
    close() {
      socket.close();
    },
  };
}
