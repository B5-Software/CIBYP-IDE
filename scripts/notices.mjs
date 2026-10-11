import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
let notice =
  "Third-party runtime notices for Could I Be Your Partner IDE integrations\n\n";
for (const [directory, metadata] of Object.entries(lock.packages)) {
  if (!directory || metadata.dev || metadata.devOptional) continue;
  const files = await readdir(directory);
  const license = files.find((file) =>
    /^licen[sc]e(?:[-.].*)?$/i.test(file),
  );
  if (!license)
    throw new Error(`Runtime dependency has no license notice: ${directory}`);
  notice += `${directory} ${metadata.version}\n${"=".repeat(72)}\n${await readFile(join(directory, license), "utf8")}\n\n`;
}
notice += `commonmark-java / commonmark-ext-gfm-tables 0.24.0\n${"=".repeat(72)}\n${await readFile("licenses/commonmark-0.24.0.txt", "utf8")}`;
await writeFile("THIRD-PARTY-NOTICES.txt", notice);
await writeFile("vscode/THIRD-PARTY-NOTICES.txt", notice);
