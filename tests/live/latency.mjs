import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "devguard.mjs");
const runs = Number(process.argv[2] || 40);
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "dglat-")));
for (const r of ["a", "b"]) {
  mkdirSync(join(root, r));
  execFileSync("git", ["-C", join(root, r), "init", "-q"]);
}
const cases = {
  "same-repo": join(root, "a", "x.md"),
  "cross-repo": join(root, "b", "x.md"),
};
const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const rows = [];
for (const [name, target] of Object.entries(cases)) {
  const input = JSON.stringify({ session_id: "lat", cwd: join(root, "a"), transcript_path: "", tool_name: "Write", tool_input: { file_path: target } });
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t = process.hrtime.bigint();
    spawnSync(process.execPath, [entry, "hook"], { input, env: { PATH: process.env.PATH, HOME: root, CLAUDE_PROJECT_DIR: join(root, "a") } });
    times.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  times.sort((x, y) => x - y);
  rows.push({ name, p50: pct(times, 50), p95: pct(times, 95), max: times[times.length - 1] });
}
console.log(JSON.stringify({ node: process.version, platform: `${process.platform}-${process.arch}`, runs, rows }, null, 2));
