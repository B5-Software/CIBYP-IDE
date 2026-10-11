import * as vscode from "vscode";
import assert from "node:assert/strict";
import { fixture } from "./fixture";
import { screenshot } from "./screenshot";
export async function run() {
  const f = await fixture();
  try {
    const extension = vscode.extensions.getExtension("b5-software.cibyp");
    assert.ok(extension);
    const api = await extension.activate();
    await api.connect({
      url: f.url,
      token: f.token,
      pid: process.pid,
      local: true,
    });
    assert.ok(
      f.calls.some(
        (c) =>
          c.method === "setWorkspace" &&
          c.args[1] === vscode.workspace.workspaceFolders?.[0].uri.fsPath,
      ),
    );
    assert.ok(f.calls.some((c) => c.method === "initialize"));
    const doc = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "const answer = 42;",
    });
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand("cibyp.stop");
    assert.ok(f.calls.some((c) => c.method === "stop"));
    await api.newConversation();
    assert.equal(f.sessions.length, 2);
    await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    await vscode.commands.executeCommand("notifications.clearAll");
    for (const [theme, file] of [
      ["Default Dark Modern", "vscode-dark.png"],
      ["Default Light Modern", "vscode-light.png"],
    ]) {
      await vscode.workspace
        .getConfiguration("workbench")
        .update("colorTheme", theme, vscode.ConfigurationTarget.Global);
      await new Promise((r) => setTimeout(r, 900));
      await screenshot(file);
    }
    api.disconnect();
    console.log(
      "[IDE] PASS: real VS Code extension host, shared connection, workspace initialization, new conversation, stop and theme screenshots.",
    );
  } finally {
    await f.close();
  }
}
