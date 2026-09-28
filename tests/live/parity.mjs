import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const goBin = process.argv[2];
if (!goBin) {
  console.error("usage: node tests/live/parity.mjs <path to the nf-hooks binary>");
  process.exit(2);
}
const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "devguard.mjs");
const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "dgparity-")));
const [a, b, plain, hub, src] = ["a", "b", "plain", "hub", "src"].map((n) => join(root, n));
for (const d of [a, b, hub, src]) {
  mkdirSync(d);
  git(d, "init", "-q");
  writeFileSync(join(d, "f.txt"), "x\n");
  git(d, "add", ".");
  git(d, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
}
mkdirSync(plain);
mkdirSync(join(b, "sub"));
writeFileSync(join(b, ".gitignore"), ".local/\n");
symlinkSync(b, join(a, "linked"));
git(hub, "-c", "protocol.file.allow=always", "submodule", "add", "-q", src, "pkg");
const overlayHub = join(root, "overlayhub");
mkdirSync(overlayHub);
git(overlayHub, "init", "-q");
writeFileSync(join(overlayHub, "f.txt"), "x\n");
git(overlayHub, "add", ".");
git(overlayHub, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
git(overlayHub, "-c", "protocol.file.allow=always", "submodule", "add", "-q", src, "pkg");
mkdirSync(join(overlayHub, ".claude", "rules"), { recursive: true });
writeFileSync(join(overlayHub, ".claude", "rules", "user-hub-submodules.md"), "# Hub\n");
const broken = join(root, "broken");
mkdirSync(broken);
writeFileSync(join(broken, ".git"), "gitdir: /nonexistent/elsewhere\n");
git(a, "worktree", "add", "-q", "-b", "wt", join(a, ".wt"));

const envLine = (...dirs) => JSON.stringify({ type: "attachment", attachment: { type: "environment", snapshot: { additionalWorkingDirectories: dirs } } });
const transcript = (...lines) => {
  const p = join(mkdtempSync(join(root, "t-")), "s.jsonl");
  writeFileSync(p, lines.join("\n") + "\n");
  return p;
};
const withSub = transcript(envLine(join(b, "sub")));
const removed = transcript(envLine(b), envLine());
const big = `{"type":"user","message":{"content":"${"z".repeat(3 << 20)}"}}`;
const far = transcript(big, envLine(b), big, big);
const memDir = join(homedir(), ".claude", "memory");
let hasMem = true;
try {
  statSync(memDir);
} catch {
  hasMem = false;
}
const vol = (() => {
  if (process.platform !== "darwin") return "";
  const st = statSync(b, { bigint: true });
  return join("/.vol", String(st.dev), String(st.ino));
})();

const cases = [
  ["same repo", a, a, join(a, "x.md")],
  ["same repo new subdir", a, a, join(a, "n", "d", "x.md")],
  ["non-git target", a, a, join(root, "loose", "x.md")],
  ["gitignored in other repo", a, a, join(b, ".local", "n.md")],
  ["other repo", a, a, join(b, "x.md")],
  ["other repo new dir", a, a, join(b, "new", "x.md")],
  ["through a symlink", a, a, join(a, "linked", "y.md")],
  ["relative into other repo", a, a, "../b/x.md"],
  ["notebook_path into other repo", a, a, join(b, "n.ipynb"), { key: "notebook_path" }],
  ["root A, cwd B, target B", b, a, join(b, "x.md")],
  ["root A, cwd B, target A", b, a, join(a, "x.md")],
  ["non-git session root", plain, plain, join(b, "x.md")],
  ["allowed dir", a, a, join(b, "sub", "x.md"), { transcript: withSub }],
  ["sibling of allowed dir", a, a, join(b, "other", "x.md"), { transcript: withSub }],
  ["prefix of allowed dir", a, a, join(b, "subx", "x.md"), { transcript: withSub }],
  ["removed allowed dir", a, a, join(b, "x.md"), { transcript: removed }],
  ["snapshot far from EOF", a, a, join(b, "x.md"), { transcript: far }],
  ["missing transcript", a, a, join(b, "x.md"), { transcript: join(root, "absent.jsonl") }],
  ["worktree root, write into main", join(a, ".wt"), join(a, ".wt"), join(a, "x.md")],
  ["hub -> submodule, no opt-in", hub, hub, join(hub, "pkg", "t.md")],
  ["hub -> submodule, Go overlay file", overlayHub, overlayHub, join(overlayHub, "pkg", "t.md"), { expect: "Go reads the overlay rule file; devguard needs the user option hub_repos (D11)" }],
  ["submodule -> hub", join(hub, "pkg"), join(hub, "pkg"), join(hub, "r.md")],
  ["repo git cannot read", a, a, join(broken, "x.md"), { expect: "Go treats a failed git call as non-git and allows; devguard treats a .git entry as a repo" }],
  ["devguard config file", a, a, join(a, ".claude", "cyberine-devguard.json"), { expect: "devguard always asks about its own config file" }],
  ["Claude Code settings file", a, a, join(a, ".claude", "settings.local.json"), { expect: "devguard always asks about settings files (additionalDirectories self-grant)" }],
];
if (hasMem) cases.push(["~/.claude/memory", a, a, join(memDir, "parity-probe.md"), { expect: "Go hard-codes ~/.claude/memory; devguard dropped it (D5) and offers extra_allowed_dirs" }]);
if (vol) cases.push(["/.vol spelling of other repo", a, a, join(vol, "x.md")]);

const blocks = (out) => {
  if (!out.trim()) return false;
  const d = JSON.parse(out).hookSpecificOutput?.permissionDecision;
  return d === "deny" || d === "ask";
};

let n = 0;
let same = 0;
const rows = [];
for (const [name, cwd, projectDir, target, opt = {}] of cases) {
  n += 1;
  const input = JSON.stringify({ session_id: `parity-${process.pid}-${n}`, cwd, transcript_path: opt.transcript ?? "", tool_name: "Write", tool_input: { [opt.key ?? "file_path"]: target } });
  const env = { PATH: process.env.PATH, HOME: homedir(), CLAUDE_PROJECT_DIR: projectDir };
  const go = spawnSync(goBin, ["cross-repo-guard"], { input, env, encoding: "utf8" });
  const dg = spawnSync(process.execPath, [entry, "hook"], { input, env: { ...env, CLAUDE_PLUGIN_OPTION_READ_TRANSCRIPT: "true" }, encoding: "utf8" });
  const g = blocks(go.stdout);
  const d = blocks(dg.stdout);
  if (g === d) same += 1;
  rows.push(`| ${name} | ${g ? "block" : "pass"} | ${d ? "block" : "pass"} | ${g === d ? "same" : opt.expect ? `accepted: ${opt.expect}` : "UNEXPECTED"} |`);
}
console.log(`| case | Go hook | devguard | verdict |\n|---|---|---|---|\n${rows.join("\n")}\n\n${same} of ${n} cases agree.`);
