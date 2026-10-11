import * as vscode from "vscode";
import assert from "node:assert/strict";
import { fixture } from "./fixture";
import { screenshot } from "./screenshot";
import { webviewDriver } from "./webview-driver";
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
    const file = vscode.Uri.joinPath(
      vscode.workspace.workspaceFolders![0].uri,
      "selection.ts",
    );
    await vscode.workspace.fs.writeFile(
      file,
      Buffer.from("const answer = 42;"),
    );
    const doc = await vscode.workspace.openTextDocument(file),
      editor = await vscode.window.showTextDocument(doc);
    await editor.edit((edit) =>
      edit.replace(new vscode.Range(0, 0, 0, 18), "const answer = missing;"),
    );
    editor.selection = new vscode.Selection(0, 0, 0, doc.lineAt(0).text.length);
    const diagnostics =
      vscode.languages.createDiagnosticCollection("cibyp-test");
    diagnostics.set(file, [
      new vscode.Diagnostic(
        editor.selection,
        "Name is missing",
        vscode.DiagnosticSeverity.Error,
      ),
    ]);
    await vscode.commands.executeCommand("cibyp.attach");
    const driver = await webviewDriver();
    try {
      assert.match(
        await driver.evaluate(
          "return d.getElementById('attachments').textContent;",
        ),
        /selection.ts/,
      );
      assert.ok(
        !(await driver.evaluate("return d.body.textContent;")).includes(
          "MUST-NOT-REACH-WEBVIEW",
        ),
      );
      await driver.evaluate(
        "const input=d.getElementById('input');input.value='Review the selected code';input.dispatchEvent(new Event('input',{bubbles:true}));d.getElementById('send').click();return true;",
      );
      for (
        let i = 0;
        i < 100 && !f.calls.some((c) => c.method === "submitMessage");
        i++
      )
        await new Promise((r) => setTimeout(r, 30));
      assert.equal(
        f.calls.filter((c) => c.method === "submitMessage").length,
        1,
      );
      const upload = f.calls.find((c) => c.method === "uploadAttachment");
      assert.ok(upload);
      const context = Buffer.from(upload.args[1].data, "base64").toString();
      assert.match(context, /missing/);
      assert.match(context, /Name is missing/);
      assert.equal(
        f.calls.find((c) => c.method === "submitMessage").args[2].length,
        1,
      );
    } finally {
      driver.close();
      diagnostics.dispose();
    }
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
