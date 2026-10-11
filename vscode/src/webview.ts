import MarkdownIt from "markdown-it";
declare function acquireVsCodeApi(): {
  postMessage(value: unknown): void;
  getState(): any;
  setState(value: unknown): void;
};
const vscode = acquireVsCodeApi(),
  md = new MarkdownIt({ html: false, linkify: false, breaks: true });
let zh = false,
  key = "",
  interactionId = "",
  sending = false,
  drafts: Record<string, string> = vscode.getState()?.drafts || {};
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = el<HTMLTextAreaElement>("input"),
  t = (en: string, cn: string) => (zh ? cn : en);
const post = (type: string, extra: Record<string, unknown> = {}) =>
  vscode.postMessage({ type, key, ...extra });
for (const id of ["new", "history", "attach", "file", "stop"])
  el(id).addEventListener("click", () => post(id));
el("instance").addEventListener("click", () => post("connect"));
el("usage").addEventListener("click", () => post("usage"));
function saveDraft() {
  if (key) drafts[key] = input.value;
  vscode.setState({ drafts });
}
input.addEventListener("input", saveDraft);
function send() {
  if (sending || !key || !input.value.trim()) return;
  sending = true;
  el<HTMLButtonElement>("send").disabled = true;
  post("send", { text: input.value });
}
el("send").addEventListener("click", send);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function renderMessages(messages: any[]) {
  const list = el("messages"),
    nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
  const fragment = document.createDocumentFragment();
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = `<strong>${t("Your workspace, with a partner", "让工作区多一位伙伴")}</strong><p>${t("Connect an instance, attach code, and describe your task.", "连接实例、附加代码，然后描述你的任务。")}</p><button data-action="connect">${t("Connect to instance", "连接实例")}</button>`;
    fragment.append(empty);
  }
  for (const message of messages) {
    if (!["user", "assistant", "system", "tool"].includes(message.role))
      continue;
    const article = document.createElement("article");
    article.className = `message ${message.role}`;
    const label = document.createElement("div");
    label.className = "label";
    label.textContent =
      message.role === "user"
        ? t("You", "你")
        : message.role === "assistant"
          ? "CIBYP"
          : message.role === "tool"
            ? t("Tool result", "工具结果")
            : t("System", "系统");
    article.append(label);
    if (message.reasoning) {
      const reasoning = document.createElement("details"),
        summary = document.createElement("summary");
      summary.textContent =
        message.reasoningKind === "summary"
          ? t("Reasoning summary", "推理摘要")
          : t("Reasoning", "推理");
      const content = document.createElement("div");
      content.textContent = message.reasoning;
      reasoning.append(summary, content);
      article.append(reasoning);
    }
    const body = document.createElement("div");
    body.className = "markdown";
    body.innerHTML =
      message.role === "tool"
        ? `<details><summary>${t("View output", "查看输出")}</summary><pre>${escape(message.content)}</pre></details>`
        : md.render(message.content || "");
    body.querySelectorAll("pre > code").forEach((code) => {
      const button = document.createElement("button");
      button.className = "code-action";
      button.textContent = t("Review in editor", "在编辑器审查");
      button.addEventListener("click", () =>
        post("preview", {
          code: code.textContent,
          language: code.className.replace("language-", ""),
        }),
      );
      code.parentElement?.append(button);
    });
    article.append(body);
    for (const attachment of message.attachments || []) {
      const chip = document.createElement("div");
      chip.className = "attachment";
      chip.textContent = `▤ ${attachment.name || "File"}`;
      chip.title = attachment.path || "";
      article.append(chip);
    }
    for (const call of message.tool_calls || []) {
      const details = document.createElement("details"),
        title = document.createElement("summary"),
        args = document.createElement("pre");
      title.textContent = `⌘ ${call.function.name}`;
      args.textContent = call.function.arguments;
      details.append(title, args);
      article.append(details);
    }
    fragment.append(article);
  }
  const live = document.createElement("article");
  live.id = "stream";
  live.className = "message assistant";
  fragment.append(live);
  list.replaceChildren(fragment);
  if (nearBottom) list.scrollTop = list.scrollHeight;
}
document.addEventListener("click", (event) => {
  const target = event.target as Element,
    link = target.closest("a");
  if (link) {
    event.preventDefault();
    post("openLink", { url: link.getAttribute("href") });
  }
  const action = target.closest("[data-action]")?.getAttribute("data-action");
  if (action) post(action);
});
window.addEventListener("message", ({ data }) => {
  if (data.type === "locale") {
    zh = !!data.zh;
    return;
  }
  if (data.type === "view") {
    const view = data.view;
    if (key !== view.session.key) {
      saveDraft();
      key = view.session.key;
      input.value = drafts[key] || "";
      sending = false;
    }
    el("title").textContent = view.session.title || t("New", "新对话");
    el("title").title = view.session.workspacePath || "";
    input.disabled = false;
    el<HTMLButtonElement>("send").disabled = sending;
    el("stop").hidden = !view.session.busy;
    const stats = view.stats || {},
      context = stats.context || {};
    el("usage").textContent =
      `${view.session.model || ""} ${context.used ? ` · ${Math.round(context.used / 1000)}K/${Math.round(context.max / 1000)}K` : ""}`;
    renderMessages(view.messages);
    const attachments = el("attachments");
    attachments.replaceChildren();
    (data.attachments || []).forEach((name: string, index: number) => {
      const chip = document.createElement("button");
      chip.className = "attachment";
      chip.textContent = `▤ ${name} ×`;
      chip.title = t("Remove attachment", "移除附件");
      chip.addEventListener("click", () => post("remove", { index }));
      attachments.append(chip);
    });
    const pending = view.pendingInteraction,
      card = el("interaction");
    interactionId = data.interactionId;
    card.hidden = !pending;
    card.replaceChildren();
    if (pending) {
      const title = document.createElement("strong"),
        details = document.createElement("pre");
      title.textContent =
        pending.kind === "questions"
          ? t("CIBYP has a question", "CIBYP 有问题需要回答")
          : `${t("Permission required", "需要授权")} · ${pending.payload.toolName || ""}`;
      details.textContent = JSON.stringify(
        pending.payload.args || pending.payload.questions || {},
        null,
        2,
      );
      card.append(title, details);
      for (const [approve, label] of pending.kind === "questions"
        ? [[true, t("Answer…", "回答…")]]
        : [
            [false, t("Deny", "拒绝")],
            [true, t("Allow once", "仅允许本次")],
          ]) {
        const button = document.createElement("button");
        button.textContent = String(label);
        button.addEventListener("click", () => {
          button.disabled = true;
          post("respond", { interactionId, approve });
        });
        card.append(button);
      }
    }
  }
  if (data.type === "connection") {
    el("connection").textContent = data.connected ? "●" : "○";
    el("instance").title = data.url || "CIBYP";
    input.disabled = !data.connected;
    el<HTMLButtonElement>("send").disabled = !data.connected || sending;
  }
  if (data.type === "stream") {
    const live = el("stream");
    if (live) {
      live.textContent = data.text;
      const list = el("messages");
      if (list.scrollHeight - list.scrollTop - list.clientHeight < 150)
        list.scrollTop = list.scrollHeight;
    }
  }
  if (data.type === "sent" && data.key === key) {
    if (input.value === data.text) input.value = "";
    sending = false;
    saveDraft();
    el<HTMLButtonElement>("send").disabled = false;
  }
  if (
    data.type === "sent" &&
    data.key !== key &&
    drafts[data.key] === data.text
  ) {
    delete drafts[data.key];
    vscode.setState({ drafts });
  }
  if (data.type === "send-failed" && data.key === key) {
    sending = false;
    el<HTMLButtonElement>("send").disabled = false;
  }
  if (data.type === "notice") el("notice").textContent = data.message;
  if (data.type === "draft") {
    input.value = data.text;
    saveDraft();
    input.focus();
  }
  if (data.type === "clear") {
    saveDraft();
    key = "";
    renderMessages([]);
    el("interaction").hidden = true;
    input.disabled = true;
  }
});
renderMessages([]);
post("ready");
