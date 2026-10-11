import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import "./notices.mjs";
await mkdir("vscode/dist", { recursive: true });
await build({
  entryPoints: ["vscode/src/extension.ts"],
  outfile: "vscode/dist/extension.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  external: ["vscode"],
  sourcemap: false,
});
await build({
  entryPoints: ["vscode/src/webview.ts"],
  outfile: "vscode/dist/webview.js",
  bundle: true,
  platform: "browser",
  target: "es2022",
});
await copyFile("vscode/media/chat.css", "vscode/dist/chat.css");
await build({
  entryPoints: ["tests/vscode-suite.ts"],
  outfile: ".cache/vscode-suite.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  external: ["vscode"],
});
