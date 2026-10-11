import * as vscode from "vscode";
import { randomBytes, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { BackendClient } from "../../shared/client";
import { discover } from "../../shared/discovery";
import {
  checked,
  Instance,
  publicView,
  Session,
  Snapshot,
  visibleSession,
} from "../../shared/protocol";
import { contextPrompt } from "../../shared/context";

const tr = (en: string, zh: string) =>
  vscode.env.language.toLowerCase().startsWith("zh") ? zh : en;
interface Attachment {
  name: string;
  data: string;
  type: string;
}
class CibypView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private client?: BackendClient;
  private key?: string;
  private sessions: Session[] = [];
  private attachments: Attachment[] = [];
  private refreshTimer?: NodeJS.Timeout;
  private refreshRunning = false;
  private refreshAgain = false;
  private generation = 0;
  private connecting = 0;
  private interactionId = "";
  private status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    50,
  );
  private stream = "";
  constructor(private context: vscode.ExtensionContext) {
    this.status.command = "cibyp.connect";
    this.updateStatus(false);
    this.status.show();
  }
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const root = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    view.webview.options = { enableScripts: true, localResourceRoots: [root] };
    const nonce = randomBytes(18).toString("base64");
    const resource = (name: string) =>
      view.webview.asWebviewUri(vscode.Uri.joinPath(root, name));
    view.webview.html = `<!doctype html><html lang="${vscode.env.language}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${view.webview.cspSource};"><link rel="stylesheet" href="${resource("chat.css")}"></head><body><header><button id="instance" title="${tr("Connect / switch instance", "连接 / 切换实例")}">CIBYP <span id="connection">○</span></button><span id="title"></span><button id="history" aria-label="${tr("History", "历史")}">↺</button><button id="new" aria-label="${tr("New conversation", "新建对话")}">＋</button></header><main id="messages" aria-live="polite"></main><section id="interaction" hidden></section><footer><div id="attachments"></div><textarea id="input" rows="3" aria-label="${tr("Message", "消息")}" placeholder="${tr("Describe a task…", "描述任务…")}"></textarea><div class="actions"><button id="attach">${tr("＋ Context", "＋ 上下文")}</button><button id="file">${tr("File", "文件")}</button><span id="usage"></span><button id="stop" hidden>${tr("Stop", "停止")}</button><button id="send" class="primary">${tr("Send", "发送")}</button></div><div id="notice" role="status"></div></footer><script nonce="${nonce}" src="${resource("webview.js")}"></script></body></html>`;
    view.webview.onDidReceiveMessage(
      (message) => this.onMessage(message).catch((e) => this.error(e)),
      undefined,
      this.context.subscriptions,
    );
    void this.post({
      type: "locale",
      zh: vscode.env.language.toLowerCase().startsWith("zh"),
    });
    void this.refresh();
  }
  private post(value: unknown) {
    return this.view?.webview.postMessage(value);
  }
  private error(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    void this.post({ type: "notice", message });
    void vscode.window.showErrorMessage(`CIBYP: ${message}`);
  }
  private updateStatus(connected: boolean) {
    this.status.text = connected
      ? "$(plug) CIBYP"
      : "$(debug-disconnect) CIBYP";
    this.status.tooltip = connected
      ? `${tr("Connected", "已连接")}: ${this.client?.url}`
      : tr("Connect to a CIBYP instance", "连接 CIBYP 实例");
    void this.post({
      type: "connection",
      connected,
      url: this.client?.url || "",
    });
  }
  private requireClient() {
    if (!this.client)
      throw new Error(tr("Connect to an instance first.", "请先连接实例。"));
    return this.client;
  }
  async connect(instance?: Instance): Promise<void> {
    const connecting = ++this.connecting;
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust this workspace before connecting.");
    if (!instance) {
      const local = await discover();
      const choice = await vscode.window.showQuickPick(
        [
          ...local.map((i) => ({
            label: `$(device-desktop) ${i.label}`,
            description: i.url,
            instance: i,
            action: "local",
          })),
          {
            label: tr("$(globe) Remote instance…", "$(globe) 远程实例…"),
            description: tr(
              "HTTPS or local SSH tunnel",
              "HTTPS 或本机 SSH 隧道",
            ),
            action: "remote",
            instance: undefined,
          },
          {
            label: tr("$(play) Start local CIBYP", "$(play) 启动本机 CIBYP"),
            description: "",
            action: "start",
            instance: undefined,
          },
        ],
        {
          title: tr("Connect CIBYP instance", "连接 CIBYP 实例"),
          placeHolder: tr(
            "GUI, TUI and WebUI share the same backend",
            "GUI、TUI、WebUI 共用同一个后台",
          ),
        },
      );
      if (!choice) return;
      if (choice.action === "start") return this.start();
      if (choice.instance) instance = choice.instance;
      else {
        const url = await vscode.window.showInputBox({
          title: tr("Remote CIBYP URL", "远程 CIBYP 地址"),
          value: this.context.globalState.get("lastRemote", "https://"),
          ignoreFocusOut: true,
        });
        if (!url) return;
        const token = (await this.context.secrets.get(`cibyp:${url}`)) || "";
        instance = { url, token, local: false };
        if (!token) instance = await this.login(instance);
      }
    }
    const candidate = new BackendClient(instance);
    let snapshot: Snapshot;
    try {
      snapshot = await candidate.connect();
    } catch (error) {
      candidate.close();
      if (!instance.local && instance.token && (error as any).status === 401) {
        await this.context.secrets.delete(`cibyp:${instance.url}`);
        const signedIn = await this.login({ ...instance, token: "" });
        return this.connect(signedIn);
      }
      throw error;
    }
    if (connecting !== this.connecting) {
      candidate.close();
      return;
    }
    this.client?.close();
    this.client = candidate;
    const generation = ++this.generation;
    this.key = undefined;
    this.attachments = [];
    this.stream = "";
    this.applySnapshot(snapshot);
    this.updateStatus(true);
    candidate.onEvent((event) => {
      if (generation !== this.generation) return;
      if (event.type === "connection") this.updateStatus(!!event.connected);
      else if (event.type === "authentication-required") {
        this.disconnect();
        void this.post({
          type: "notice",
          message: tr(
            "Session expired. Connect again to sign in.",
            "登录已过期，请重新连接。",
          ),
        });
      } else if (event.type === "snapshot") {
        this.applySnapshot(event.payload);
        this.queueRefresh();
      } else if (event.channel === "agent:session-event") {
        const data = event.payload;
        if (data.key === this.key && data.type === "stream-start")
          this.stream = "";
        if (data.key === this.key && data.type === "stream-chunk") {
          this.stream +=
            data.data?.content ||
            data.data?.delta ||
            (typeof data.data === "string" ? data.data : "");
          void this.post({ type: "stream", text: this.stream });
        }
        if (
          data.key === this.key &&
          (data.type === "stream-end" || data.type === "message")
        )
          this.stream = "";
        if (data.type !== "stream-chunk" && data.type !== "agent-message")
          this.queueRefresh();
      }
    });
    if (!this.key) await this.newConversation();
    else await this.refresh();
    await vscode.commands.executeCommand("cibyp.chat.focus");
  }
  private async login(instance: Instance): Promise<Instance> {
    const password = await vscode.window.showInputBox({
      title: tr("CIBYP WebUI password", "CIBYP WebUI 访问密码"),
      password: true,
      ignoreFocusOut: true,
    });
    if (!password) throw new Error(tr("Sign-in cancelled.", "已取消登录。"));
    const code = await vscode.window.showInputBox({
      title: tr(
        "Two-factor code (leave blank if disabled)",
        "二次验证码（未启用可留空）",
      ),
      password: true,
      ignoreFocusOut: true,
    });
    if (code === undefined) throw new Error("Sign-in cancelled.");
    const client = new BackendClient(instance);
    const token = await client.login(password, code);
    client.close();
    await this.context.secrets.store(`cibyp:${instance.url}`, token);
    await this.context.globalState.update("lastRemote", instance.url);
    return { ...instance, token };
  }
  disconnect() {
    this.connecting++;
    this.generation++;
    this.client?.close();
    this.client = undefined;
    this.key = undefined;
    this.attachments = [];
    this.stream = "";
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.updateStatus(false);
    void this.post({ type: "clear" });
  }
  start() {
    const configured = vscode.workspace
      .getConfiguration("cibyp")
      .get<string>("startCommand", "cibyp-tui");
    const terminal = vscode.window.createTerminal({
      name: "CIBYP",
      shellPath: configured,
    });
    terminal.show();
    void vscode.window.showInformationMessage(
      tr(
        "CIBYP is starting. Choose Connect to Instance when it is ready.",
        "CIBYP 正在启动，就绪后选择“连接实例”。",
      ),
    );
  }
  private applySnapshot(snapshot: Snapshot) {
    this.sessions = snapshot.sessions.filter(visibleSession);
    if (!this.sessions.some((s) => s.key === this.key)) {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      this.key = this.client?.instance.local
        ? this.sessions.find(
            (s) =>
              s.mode === "code" &&
              (s.hostWorkspacePath === folder || s.workspacePath === folder),
          )?.key
        : undefined;
    }
  }
  private queueRefresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh().catch((e) => this.error(e));
    }, 150);
  }
  private async refresh() {
    if (this.refreshRunning) {
      this.refreshAgain = true;
      return;
    }
    if (!this.client) {
      void this.post({ type: "clear" });
      return;
    }
    this.refreshRunning = true;
    const client = this.client,
      generation = this.generation;
    try {
      this.sessions = (await client.request<Session[]>("listSessions")).filter(
        visibleSession,
      );
      if (!this.key || !this.sessions.some((s) => s.key === this.key))
        this.key = this.sessions[0]?.key;
      if (!this.key) {
        void this.post({ type: "clear" });
        return;
      }
      const key = this.key,
        raw = await client.request("getView", key);
      if (generation !== this.generation || key !== this.key || !raw) return;
      const view = publicView(raw);
      this.interactionId = JSON.stringify(view.pendingInteraction || null);
      void this.post({
        type: "view",
        view,
        interactionId: this.interactionId,
        attachments: this.attachments.map((a) => a.name),
      });
      if (this.stream) void this.post({ type: "stream", text: this.stream });
    } finally {
      this.refreshRunning = false;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        this.queueRefresh();
      }
    }
  }
  async newConversation() {
    const client = this.requireClient(),
      generation = this.generation;
    let workspace: string | undefined;
    if (client.instance.local) {
      const folders = vscode.workspace.workspaceFolders || [];
      const folder =
        folders.length > 1
          ? await vscode.window.showWorkspaceFolderPick()
          : folders[0];
      if (!folder || folder.uri.scheme !== "file")
        throw new Error(
          tr(
            "Open a local workspace folder first.",
            "请先打开本机工作区文件夹。",
          ),
        );
      workspace = folder.uri.fsPath;
    } else {
      workspace = await vscode.window.showInputBox({
        title: tr(
          "Workspace on the remote CIBYP machine",
          "远程 CIBYP 主机上的工作区",
        ),
        value: vscode.workspace
          .getConfiguration("cibyp")
          .get("remoteWorkspace", ""),
        placeHolder: "/workspace/project",
      });
      if (!workspace) return;
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: tr("Preparing CIBYP workspace…", "正在准备 CIBYP 工作区…"),
      },
      async () => {
        if (generation !== this.generation) return;
        const session = await client.request<Session>("createSession", {
          key: `ide-vscode-${randomUUID()}`,
          mode: "code",
        });
        try {
          checked(await client.request("setWorkspace", session.key, workspace));
          await client.request("initialize", { key: session.key });
        } catch (error) {
          await client.request("close", session.key).catch(() => {});
          throw error;
        }
        if (generation !== this.generation) return;
        this.key = session.key;
        this.attachments = [];
        this.stream = "";
        await this.refresh();
      },
    );
  }
  async switchSession() {
    const client = this.requireClient();
    const sessions = (await client.request<Session[]>("listSessions")).filter(
      visibleSession,
    );
    const active = sessions.find((s) => s.key === this.key);
    const history = active
      ? await client.request<any[]>(
          "listHistory",
          active.mode,
          active.workspacePath,
        )
      : [];
    const choice = await vscode.window.showQuickPick(
      [
        ...sessions.map((s) => ({
          label: `$(comment-discussion) ${s.title || tr("New", "新对话")}`,
          description: `${s.mode} · ${s.status}`,
          session: s,
          history: undefined as any,
        })),
        ...history
          .filter((h) => !sessions.some((s) => s.conversationId === h.id))
          .map((h) => ({
            label: `$(history) ${h.title || tr("Untitled", "未命名")}`,
            description: tr("Saved history", "已保存的历史"),
            session: undefined,
            history: h,
          })),
      ],
      { title: tr("Conversations and history", "对话与历史") },
    );
    if (!choice) return;
    if (choice.session) this.key = choice.session.key;
    else if (active) {
      const target = await client.request<Session>("createSession", {
        key: `ide-vscode-${randomUUID()}`,
        mode: active.mode,
        workspacePath: active.workspacePath,
        codeWorkspacePath: active.workspacePath,
      });
      await client.request("openHistory", target.key, choice.history.id);
      this.key = target.key;
    }
    this.attachments = [];
    this.stream = "";
    await this.refresh();
  }
  async attachSelection() {
    this.requireClient();
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file")
      throw new Error(
        tr("Select a local editor file first.", "请先选择本机编辑器文件。"),
      );
    const selected = editor.selection;
    const range = selected.isEmpty
      ? new vscode.Range(
          0,
          0,
          Math.min(editor.document.lineCount - 1, 500),
          100000,
        )
      : selected;
    const diagnostics = vscode.languages
      .getDiagnostics(editor.document.uri)
      .filter((d) => d.range.intersection(range))
      .map((d) => ({
        line: d.range.start.line + 1,
        severity: vscode.DiagnosticSeverity[d.severity],
        message: d.message,
      }));
    const text = contextPrompt({
      path: vscode.workspace.asRelativePath(editor.document.uri),
      language: editor.document.languageId,
      text: editor.document.getText(range),
      startLine: range.start.line + 1,
      endLine: range.end.line + 1,
      diagnostics,
    });
    if (this.attachments.length >= 10)
      throw new Error("At most 10 attachments per message.");
    this.attachments.push({
      name: `${basename(editor.document.fileName)}-selection.txt`,
      data: Buffer.from(text).toString("base64"),
      type: "text/plain",
    });
    await vscode.commands.executeCommand("cibyp.chat.focus");
    await this.refresh();
  }
  async prompt(task: "explain" | "review") {
    if (!this.client) await this.connect();
    if (!this.client) return;
    await this.attachSelection();
    void this.post({
      type: "draft",
      text:
        task === "explain"
          ? tr(
              "Explain the attached code and its important behavior.",
              "解释附加的代码及其重要行为。",
            )
          : tr(
              "Review the attached code for bugs, security and correctness.",
              "审查附加代码的缺陷、安全性和正确性。",
            ),
    });
  }
  async stop() {
    if (this.key) await this.requireClient().request("stop", this.key);
  }
  async usage() {
    if (!this.key) return;
    const client = this.requireClient();
    const usage = await client.request("getSubscriptionUsage", this.key, true);
    const doc = await vscode.workspace.openTextDocument({
      content: JSON.stringify(usage, null, 2),
      language: "json",
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  }
  private async onMessage(message: any) {
    if (!message || typeof message.type !== "string") return;
    if (message.type === "ready") {
      void this.post({
        type: "locale",
        zh: vscode.env.language.toLowerCase().startsWith("zh"),
      });
      this.updateStatus(!!this.client);
      return this.refresh();
    }
    const commands: Record<string, () => unknown> = {
      connect: () => this.connect(),
      new: () => this.newConversation(),
      history: () => this.switchSession(),
      attach: () => this.attachSelection(),
      stop: () => this.stop(),
      usage: () => this.usage(),
    };
    if (commands[message.type]) return commands[message.type]();
    if (message.type === "file") {
      const files = await vscode.window.showOpenDialog({ canSelectMany: true });
      for (const file of files || []) {
        if (this.attachments.length >= 10) break;
        const stat = await vscode.workspace.fs.stat(file);
        if (stat.size > 8 * 1024 * 1024)
          throw new Error("Files must be at most 8 MiB.");
        const bytes = await vscode.workspace.fs.readFile(file);
        this.attachments.push({
          name: basename(file.fsPath),
          data: Buffer.from(bytes).toString("base64"),
          type: "application/octet-stream",
        });
      }
      return this.refresh();
    }
    if (message.type === "remove" && Number.isInteger(message.index)) {
      this.attachments.splice(message.index, 1);
      return this.refresh();
    }
    if (message.type === "send") {
      const client = this.requireClient(),
        key = this.key;
      if (
        !key ||
        key !== message.key ||
        typeof message.text !== "string" ||
        message.text.length > 100000
      )
        return;
      const generation = this.generation,
        files = [...this.attachments];
      try {
        const attachments = [];
        for (const file of files)
          attachments.push(await client.request("uploadAttachment", key, file));
        if (generation !== this.generation) return;
        await client.request("submitMessage", key, message.text, attachments);
        if (generation !== this.generation) return;
        if (key === this.key)
          this.attachments = this.attachments.filter(
            (file) => !files.includes(file),
          );
        void this.post({ type: "sent", key, text: message.text });
        await this.refresh();
      } catch (error) {
        void this.post({ type: "send-failed", key });
        throw error;
      }
    }
    if (
      message.type === "respond" &&
      message.key === this.key &&
      message.interactionId === this.interactionId
    ) {
      const client = this.requireClient(),
        key = this.key,
        generation = this.generation,
        identity = this.interactionId;
      const view = await client.request("getSessionDetails", key);
      if (JSON.stringify(view.pendingInteraction || null) !== identity)
        throw new Error(
          tr("This request was already answered.", "这个请求已经被回答。"),
        );
      if (view.pendingInteraction.kind === "questions") {
        const answers = [];
        for (const q of view.pendingInteraction.payload.questions || []) {
          const options = (q.options || []).map((o: any) =>
            typeof o === "string" ? o : o.label || o.title,
          );
          const picked = options.length
            ? await vscode.window.showQuickPick(
                [...options, tr("Custom answer…", "自定义回答…")],
                { title: q.question || q.title },
              )
            : undefined;
          const custom =
            !options.length || picked === tr("Custom answer…", "自定义回答…");
          const answer = custom
            ? await vscode.window.showInputBox({ title: q.question || q.title })
            : picked;
          if (answer === undefined) return;
          answers.push({ question: q.question, answer });
        }
        if (generation !== this.generation || key !== this.key) return;
        const current = await client.request("getSessionDetails", key);
        if (JSON.stringify(current.pendingInteraction || null) !== identity)
          throw new Error(
            tr("This request was already answered.", "这个请求已经被回答。"),
          );
        await client.request("answerQuestions", key, answers);
      } else {
        if (generation !== this.generation || key !== this.key) return;
        await client.request(
          "respond",
          key,
          message.approve === true
            ? view.pendingInteraction.kind === "approval"
              ? true
              : "allow-once"
            : view.pendingInteraction.kind === "approval"
              ? false
              : "deny",
        );
      }
      await this.refresh();
    }
    if (
      message.type === "preview" &&
      typeof message.code === "string" &&
      message.code.length <= 1000000
    ) {
      const editor = vscode.window.activeTextEditor;
      const doc = await vscode.workspace.openTextDocument({
        content: message.code,
        language: message.language || "plaintext",
      });
      if (editor)
        await vscode.commands.executeCommand(
          "vscode.diff",
          editor.document.uri,
          doc.uri,
          tr(
            "CIBYP · Review suggested code (no files changed)",
            "CIBYP · 审查建议代码（未修改文件）",
          ),
        );
      else await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }
    if (
      message.type === "openLink" &&
      typeof message.url === "string" &&
      /^https?:\/\//.test(message.url)
    ) {
      const yes = await vscode.window.showInformationMessage(
        tr(`Open ${message.url}?`, `打开 ${message.url}？`),
        { modal: true },
        tr("Open", "打开"),
      );
      if (yes) await vscode.env.openExternal(vscode.Uri.parse(message.url));
    }
  }
  dispose() {
    this.disconnect();
    this.status.dispose();
  }
}
export function activate(context: vscode.ExtensionContext) {
  const provider = new CibypView(context);
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider("cibyp.chat", provider),
  );
  const actions: Record<string, () => unknown> = {
    connect: () => provider.connect(),
    disconnect: () => provider.disconnect(),
    start: () => provider.start(),
    new: () => provider.newConversation(),
    sessions: () => provider.switchSession(),
    attach: () => provider.attachSelection(),
    stop: () => provider.stop(),
    explain: () => provider.prompt("explain"),
    review: () => provider.prompt("review"),
    usage: () => provider.usage(),
  };
  for (const [name, action] of Object.entries(actions))
    context.subscriptions.push(
      vscode.commands.registerCommand(`cibyp.${name}`, () =>
        Promise.resolve(action()).catch((e) =>
          vscode.window.showErrorMessage(`CIBYP: ${e.message}`),
        ),
      ),
    );
  // Test facade invokes exactly the production connection and workspace flow.
  return {
    connect: (instance: Instance) => provider.connect(instance),
    newConversation: () => provider.newConversation(),
    disconnect: () => provider.disconnect(),
  };
}
