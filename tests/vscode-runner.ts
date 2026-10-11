import { runTests } from "@vscode/test-electron";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
async function main() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  await new Promise<void>((r) => server.close(() => r()));
  const workspace = resolve(".cache/workspace");
  await mkdir(workspace, { recursive: true });
  await runTests({
    extensionDevelopmentPath: resolve("vscode"),
    extensionTestsPath: resolve(".cache/vscode-suite.cjs"),
    vscodeExecutablePath: process.env.CIBYP_VSCODE_EXECUTABLE,
    extensionTestsEnv: { CIBYP_SCREENSHOT_PORT: String(port) },
    launchArgs: [
      workspace,
      "--disable-extensions",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-workspace-trust",
      `--remote-debugging-port=${port}`,
      "--user-data-dir",
      resolve(".cache/vscode-user"),
      "--extensions-dir",
      resolve(".cache/vscode-extensions"),
    ],
  });
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
