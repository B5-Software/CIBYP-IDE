import { readdir, readFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { address, Instance } from "./protocol";
export async function discover(directory = tmpdir()): Promise<Instance[]> {
  const files = await readdir(directory).catch(() => []);
  const found = await Promise.all(
    files
      .filter((f) => /^cibyp-backend-[a-f0-9]{24}\.json$/.test(f))
      .slice(0, 128)
      .map(async (file) => {
        try {
          const path = join(directory, file),
            stat = await lstat(path);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192)
            return null;
          if (
            process.platform !== "win32" &&
            ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
          )
            return null;
          const v = JSON.parse(await readFile(path, "utf8"));
          if (
            v.protocol !== 1 ||
            !/^[a-f0-9]{64}$/.test(v.token) ||
            !Number.isSafeInteger(v.pid) ||
            v.pid < 1
          )
            return null;
          process.kill(v.pid, 0);
          return {
            url: address(v.url, true),
            token: v.token,
            pid: v.pid,
            local: true,
            label: `Local · PID ${v.pid}`,
          } satisfies Instance;
        } catch {
          return null;
        }
      }),
  );
  return found.filter((v): v is NonNullable<typeof v> => !!v);
}
