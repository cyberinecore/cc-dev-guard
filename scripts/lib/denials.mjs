import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export const LOG_FILE = "decisions.jsonl";
export const LOG_RETENTION_DAYS = 30;
export const LOG_MAX_BYTES = 2 * 1024 * 1024;

export function logPath(env) {
  return isAbsolute(env.CLAUDE_PLUGIN_DATA || "") ? join(env.CLAUDE_PLUGIN_DATA, LOG_FILE) : "";
}

function readLines(path) {
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function pruneDecisionLog(env, now = Date.now()) {
  const path = logPath(env);
  if (!path) return;
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return;
  }
  const cutoff = now - LOG_RETENTION_DAYS * 86400000;
  const lines = readLines(path);
  let kept = lines.filter((l) => {
    try {
      const t = Date.parse(JSON.parse(l).time);
      return Number.isFinite(t) && t >= cutoff;
    } catch {
      return false;
    }
  });
  let bytes = kept.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0);
  while (kept.length && bytes > LOG_MAX_BYTES) bytes -= Buffer.byteLength(kept.shift()) + 1;
  if (kept.length === lines.length && bytes === size) return;
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, kept.length ? kept.join("\n") + "\n" : "", { mode: 0o600 });
  renameSync(tmp, path);
}

const FIX_PATTERNS = [
  [/"CYBERINE_DEVGUARD_REGENERABLE_PATHS": "([^"]+)"/, (m) => `declare in the repository's gitignored .claude/settings.local.json: "CYBERINE_DEVGUARD_REGENERABLE_PATHS": "${m[1]}" (your prompt must name the key or the file for Claude to write it), or the same folders in /config regenerable_paths`],
  [/add `([^`]+)` to regenerable_paths/, (m) => `add ${m[1]} to regenerable_paths in /config`],
  [/regenerable_paths \(for example `([^`]+)`\)/, (m) => `add ${m[1]} to regenerable_paths in /config`],
  [/"(CYBERINE_DEVGUARD_HUB_SUBMODULES)": "true"/, () => `set "CYBERINE_DEVGUARD_HUB_SUBMODULES": "true" in the repository's gitignored .claude/settings.local.json, or add the repository to hub_repos in /config`],
  [/register it as a submodule of `([^`]+)`/, (m) => `register the nested repository as a submodule of ${m[1]}, or add it to extra_allowed_dirs in /config`],
  [/`\/add-dir ([^`]+)`/, (m) => `/add-dir ${m[1]} for one session, or extra_allowed_dirs in /config`],
  [/label names it \(`([^`]+)`\)/, (m) => `name ${m[1]} in your prompt in the same turn`],
];

export function fixOf(reason) {
  const out = [];
  for (const [re, f] of FIX_PATTERNS) {
    const m = re.exec(reason);
    if (m) out.push(f(m));
  }
  return out;
}

const KINDS = [
  ["worktree-ignored", /`git worktree remove [^`]*` deletes|worktrees it can name/, "git worktree remove would lose ignored files", "declare the build-output folders the reason names in regenerable_paths, or name the worktree in your prompt"],
  ["worktree-force", /worktree remove (--force|-f)|recursive rm of `[^`]*\.claude\/worktrees/, "forced or rm-based worktree removal", "use plain git worktree remove without --force"],
  ["docker-all", /over `docker ps` without `--filter`|`docker \w+` through `xargs`/, "docker stop/kill/rm over every container", "add --filter label=<label>, name the containers, or use docker compose -p <project>"],
  ["kill-name", /stops processes by name or pattern|through `xargs` stops|`kill-port`|`fuser -k`|killing by port/, "kill by name, pattern or port", "kill <PID> of a process you recorded; or an exact allow_commands entry in /config"],
  ["app-quit", /AppleScript quits/, "quitting an app", "close only your own documents; quitting is left to you"],
  ["tmux", /tmux/, "tmux session this session did not create", "left to you"],
  ["volumes", /delete volumes|deletes the container's volumes/, "deleting docker volumes", "run it yourself as a ! command, or an exact allow_commands entry in /config"],
  ["discard", /discard uncommitted work|`git stash clear`/, "discarding uncommitted git work", "run it yourself as a ! command, or an exact allow_commands entry in /config"],
  ["database", /DROP|TRUNCATE|database|FLUSHALL|dropDatabase/, "deleting a database or table", "run it yourself as a ! command, or an exact allow_commands entry in /config"],
  ["rm-kept", /holds data no commit keeps/, "recursive rm of .local, .env or local settings", "declare build output there in regenerable_paths; anything else is left to you"],
  ["rm-variable", /recursive rm of `[^`]*` is denied: the target is a shell variable|through `xargs` is denied|cannot parse its quoting/, "recursive rm of a path the guard cannot resolve", "write the literal path, or assign it a literal or $(mktemp -d) earlier in the same command"],
  ["rm-absolute", /recursive rm of (absolute path )?`/, "recursive rm of an absolute path", "use a tmp dir or a path relative to the repository; for ignored build output inside a repository, regenerable_paths; outside any repository, an exact allow_commands entry in /config"],
  ["branch", /git branch -D|unpushed|no remote holds|protected branch/, "deleting a branch with unpushed commits or a protected branch", "push the commits first, or run it yourself"],
  ["settings-file", /is a Claude Code settings file|is a cyberine-devguard configuration file/, "writing a settings or guard file", "name the file or key in your prompt in the same turn"],
  ["cross-repo", /another repository|separate repository inside this session's working directory|outside this session's repository/, "writing into another repository", "/add-dir for one session, extra_allowed_dirs in /config, or the hub grant for submodules"],
  ["worktree-add", /git worktree add/, "git worktree add outside .claude/worktrees", "create worktrees under the repository's .claude/worktrees/"],
];

export function kindOf(guard, reason) {
  if (guard === "error") return { key: "error", label: "internal error", route: "update the plugin; report it if it repeats" };
  for (const [key, re, label, route] of KINDS) if (re.test(reason)) return { key, label, route };
  return { key: "other", label: reason.replace(/^Default: NO\.\s*/, "").replace(/^cyberine-devguard:\s*/, "").slice(0, 80), route: "see the reason shown to Claude" };
}

export function denialsReport(env, { days = LOG_RETENTION_DAYS, now = Date.now(), level = "stops" } = {}) {
  const path = logPath(env);
  const head = [];
  if (level === "off") head.push("Logging is off (log_decisions = off), so nothing new is recorded. Turn it on in /config: stops (the default) or all.");
  else if (level === "stops") head.push("Logging: stops (default). Writes into another repository are recorded only with log_decisions = all.");
  if (!path) return [...head, "No plugin data directory is set, so there is no log to read."].join("\n");
  const cutoff = now - days * 86400000;
  const groups = new Map();
  let total = 0;
  for (const l of readLines(path)) {
    let e;
    try {
      e = JSON.parse(l);
    } catch {
      continue;
    }
    const t = Date.parse(e.time);
    if (!Number.isFinite(t) || t < cutoff || e.verdict === "passed") continue;
    total++;
    const guard = e.guard || "scope";
    const kind = kindOf(guard, String(e.reason || ""));
    const repo = e.repo || "(unknown repository)";
    const k = `${repo}\u0000${kind.key}`;
    const g = groups.get(k) || { repo, kind, count: 0, last: 0, verdicts: new Set(), fixes: new Set() };
    g.count++;
    g.last = Math.max(g.last, t);
    g.verdicts.add(e.verdict);
    for (const f of e.fix || []) g.fixes.add(f);
    groups.set(k, g);
  }
  if (!total) return [...head, `No stops recorded in the last ${days} days.`].join("\n");
  const byRepo = new Map();
  for (const g of groups.values()) {
    if (!byRepo.has(g.repo)) byRepo.set(g.repo, []);
    byRepo.get(g.repo).push(g);
  }
  const repos = [...byRepo.entries()].sort((a, b) => b[1].reduce((n, g) => n + g.count, 0) - a[1].reduce((n, g) => n + g.count, 0));
  const out = [...head, `${total} stop${total === 1 ? "" : "s"} in the last ${days} days, in ${repos.length} repositor${repos.length === 1 ? "y" : "ies"}.`, ""];
  for (const [repo, gs] of repos) {
    out.push(`${repo}`);
    for (const g of gs.sort((a, b) => b.count - a.count)) {
      out.push(`  ${g.count}x ${g.kind.label} (${[...g.verdicts].join("/")}, last ${new Date(g.last).toISOString().slice(0, 16).replace("T", " ")} UTC)`);
      const fixes = [...g.fixes].slice(0, 3);
      if (fixes.length) for (const f of fixes) out.push(`      fix: ${f}`);
      else out.push(`      route: ${g.kind.route}`);
    }
    out.push("");
  }
  out.push("Only you can set /config options, allow_commands and the regenerable_paths key; Claude may write the settings.local.json key only when your prompt in that turn names it.");
  return out.join("\n").replace(/\n+$/, "");
}
