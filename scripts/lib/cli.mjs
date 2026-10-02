import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { configDirOf } from "./allowances.mjs";
import { loadConfig } from "./config.mjs";
import { FALLBACK_MARKER_DIR, NAME, VERSION } from "./constants.mjs";

const pluginName = NAME;
const version = VERSION;
import { allowedDirsFor, decide, sessionRootOf } from "./decide.mjs";
import { namedEnv } from "./environment.mjs";
import { makeGit } from "./git.mjs";
import { findWrites, judgeWorktreeAdds, mentionsWorktree } from "./bashguard.mjs";
import { mcpWriteTargets } from "./mcpfs.mjs";
import { render, renderError, renderWorktree } from "./output.mjs";
import { findRepos, formatScan, makeGh, scanRepo } from "./worktrees.mjs";
import { pruneSessionRecords, recordDirectoryAdded } from "./sources.mjs";

const usage = `usage: ${pluginName} <command>

  hook                      read a PreToolUse event on stdin and print a decision (used by hooks/hooks.json)
  directory-added           record a DirectoryAdded event for this session (used by hooks/hooks.json)
  session-start             warn when node is too old and prune old session records (used by hooks/hooks.json)
  explain <path> [options]  show the verdict for a write to <path>
  status [options]          show the session repository, allowed directories and configuration
  worktrees [dir...] [--no-gh]
                            report stray, prunable and merged git worktrees of each repository at or
                            under <dir> (default: the current directory); changes nothing
  --version                 print the version

options:
  --root <dir>        session root (default: $CLAUDE_PROJECT_DIR, else the current directory)
  --cwd <dir>         directory a relative <path> is resolved against (default: the current directory)
  --transcript <file> session transcript to read allowed directories from
                      (default: the transcript of $CLAUDE_CODE_SESSION_ID, when set)`;

function markerDirFor(env) {
  return isAbsolute(env.CLAUDE_PLUGIN_DATA || "") ? join(env.CLAUDE_PLUGIN_DATA, "markers") : join(tmpdir(), FALLBACK_MARKER_DIR);
}

function verdictWord(out) {
  if (!out) return "passed";
  if (out.hookSpecificOutput) return out.hookSpecificOutput.permissionDecision;
  return out.systemMessage ? "warn" : "passed";
}

function logDecision(env, input, verdict, out, now) {
  if (!isAbsolute(env.CLAUDE_PLUGIN_DATA || "")) return;
  try {
    mkdirSync(env.CLAUDE_PLUGIN_DATA, { recursive: true });
    const line = { time: new Date(now).toISOString(), session: input.session_id ?? "", tool: input.tool_name ?? "", target: verdict.target, verdict: verdictWord(out), why: verdict.why };
    appendFileSync(join(env.CLAUDE_PLUGIN_DATA, "decisions.jsonl"), JSON.stringify(line) + "\n", { mode: 0o600 });
  } catch {}
}

export function sessionStart(nodeVersion) {
  const major = Number(String(nodeVersion).split(".")[0]);
  if (major >= 18) return null;
  return { systemMessage: `${pluginName}: node ${nodeVersion} is older than 18, so the ${pluginName} write guard may not run in this session. Install Node.js 18 or later and restart Claude Code.` };
}

export function runHook({ raw, env = namedEnv(process.env), deps = {}, now = Date.now() }) {
  let input;
  try {
    try {
      input = JSON.parse(raw);
    } catch {
      return renderError(new Error("the hook input is not valid JSON"));
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) return renderError(new Error("the hook input is not a JSON object"));
    if (input.tool_name === "Bash") return bashHook(input, env, deps, now);
    if (typeof input.tool_name === "string" && input.tool_name.startsWith("mcp__")) return mcpHook(input, env, deps, now);
    const sessionRoot = sessionRootOf(env.CLAUDE_PROJECT_DIR, input.cwd);
    const config = loadConfig({ env, sessionRoot });
    if (config.mode === "off") return null;
    const verdict = (deps.decide || decide)(input, { sessionRoot, env, config });
    const out = render(verdict, { mode: config.mode, input, now, markerDir: markerDirFor(env), warnings: config.warnings });
    if (config.logDecisions && verdict.action === "cross") logDecision(env, input, verdict, out, now);
    return out;
  } catch (e) {
    return renderError(e, input);
  }
}

function bashHook(input, env, deps, now) {
  const command = input.tool_input?.command;
  if (typeof command !== "string" || command === "") return null;
  const sessionRoot = sessionRootOf(env.CLAUDE_PROJECT_DIR, input.cwd);
  const cwd = typeof input.cwd === "string" && isAbsolute(input.cwd) ? input.cwd : sessionRoot;
  const home = env.HOME || env.USERPROFILE || "";
  const writes = findWrites(command, { cwd, home });
  const worktree = mentionsWorktree(command);
  if (!writes.length && !worktree) return null;
  const config = loadConfig({ env, sessionRoot });
  if (config.mode === "off") return null;
  const git = deps.git || makeGit();
  if (worktree && config.worktreeGuard) {
    const out = renderWorktree(judgeWorktreeAdds(command, { cwd, home, git }), { mode: config.mode, input, warnings: config.warnings });
    if (out) return out;
  }
  if (!config.bashGuard) return null;
  for (const w of writes) {
    const probe = w.isDir ? join(w.target, ".devguard-probe") : w.target;
    const verdict = (deps.decide || decide)({ ...input, tool_name: "Bash", tool_input: { file_path: probe } }, { sessionRoot, env, config, deps: { git } });
    if (verdict.action !== "cross") continue;
    const shown = { ...verdict, target: w.target, via: w.how };
    const out = render(shown, { mode: config.mode, input, now, markerDir: markerDirFor(env), warnings: config.warnings });
    if (config.logDecisions) logDecision(env, input, shown, out, now);
    if (out) return out;
  }
  return null;
}

function mcpHook(input, env, deps, now) {
  const targets = mcpWriteTargets(input.tool_name, input.tool_input);
  if (!targets || !targets.length) return null;
  const sessionRoot = sessionRootOf(env.CLAUDE_PROJECT_DIR, input.cwd);
  const config = loadConfig({ env, sessionRoot });
  if (config.mode === "off") return null;
  const git = deps.git || makeGit();
  for (const t of targets) {
    const probe = t.isDir ? join(t.path, ".devguard-probe") : t.path;
    const verdict = (deps.decide || decide)({ ...input, tool_input: { file_path: probe } }, { sessionRoot, env, config, deps: { git } });
    if (verdict.action !== "cross") continue;
    const shown = { ...verdict, target: t.path };
    const out = render(shown, { mode: config.mode, input, now, markerDir: markerDirFor(env), warnings: config.warnings });
    if (config.logDecisions) logDecision(env, input, shown, out, now);
    if (out) return out;
  }
  return null;
}

function parseArgs(args) {
  const opts = { positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--no-gh") {
      opts.noGh = true;
    } else if (a === "--root" || a === "--cwd" || a === "--transcript") {
      if (i + 1 >= args.length) throw new Error(`${a} needs a value`);
      opts[a.slice(2)] = args[++i];
    } else if (a.startsWith("--")) {
      throw new Error(`unknown option ${a}`);
    } else {
      opts.positional.push(a);
    }
  }
  return opts;
}

function findTranscript(env) {
  const sid = env.CLAUDE_CODE_SESSION_ID;
  if (!sid || !/^[A-Za-z0-9-]+$/.test(sid)) return "";
  const projects = join(configDirOf(env), "projects");
  let entries = [];
  try {
    entries = readdirSync(projects);
  } catch {
    return "";
  }
  for (const d of entries) {
    const p = join(projects, d, `${sid}.jsonl`);
    try {
      if (statSync(p).isFile()) return p;
    } catch {}
  }
  return "";
}

function describeSession(opts, env) {
  const cwd = resolve(opts.cwd || process.cwd());
  const root = sessionRootOf(opts.root ? resolve(opts.root) : env.CLAUDE_PROJECT_DIR, cwd);
  const transcript = opts.transcript ? resolve(opts.transcript) : findTranscript(env);
  const config = loadConfig({ env, sessionRoot: root });
  const git = makeGit();
  const repo = root ? git.commonDir(root) : "";
  const input = { session_id: env.CLAUDE_CODE_SESSION_ID || "", cwd, transcript_path: transcript };
  const allowed = allowedDirsFor({ input, env, config, sessionRoot: root });
  const via = allowed.via || "transcript";
  const lines = [
    `${pluginName} ${version}`,
    `session root: ${root || "(none)"}`,
    `session repo: ${repo ? git.toplevel(root) : "none (not a git repository: every write passes)"}`,
    `transcript: ${transcript || "(none)"}`,
    `allowed dirs (via ${via}): ${allowed.ok ? (allowed.dirs.length ? allowed.dirs.join(", ") : "none") : `unavailable (${allowed.reason})`}`,
    ...(allowed.sources || []).map((s) => `  ${s.dir} (${s.source})`),
    ...(allowed.transcriptReason ? [`  transcript unreadable: ${allowed.transcriptReason}`] : []),
    `mode: ${config.mode}`,
    `allow ignored: ${config.allowIgnored}`,
    `read transcript: ${config.readTranscript}`,
    `bash guard: ${config.bashGuard}`,
    `worktree guard: ${config.worktreeGuard}`,
    `isolate worktrees: ${config.isolateWorktrees}`,
    `extra allowed dirs: ${config.extraAllowedDirs.join(", ") || "none"}`,
    `hub repos: ${config.hubRepos.join(", ") || "none"}`,
    `repo config file: ${config.repoFile || "none"}`,
    `protected paths: ${config.protect.join(", ") || "none"}`,
  ];
  for (const w of config.warnings) lines.push(`warning: ${w}`);
  return { cwd, root, transcript, config, lines };
}

function explain(opts, env) {
  const target = opts.positional[0];
  if (!target) throw new Error("explain needs a path");
  const s = describeSession(opts, env);
  const input = { session_id: env.CLAUDE_CODE_SESSION_ID || "explain", cwd: s.cwd, transcript_path: s.transcript, tool_name: "Write", tool_input: { file_path: target } };
  const verdict = decide(input, { sessionRoot: s.root, env, config: s.config });
  const lines = [...s.lines, `target: ${target}`];
  if (verdict.action === "pass") {
    lines.push(`verdict: pass (${verdict.why})`);
  } else {
    const out = s.config.mode === "off" ? null : render(verdict, { mode: s.config.mode === "deny-once" ? "ask" : s.config.mode, input, markerDir: tmpdir() });
    const effect = s.config.mode === "off" ? "passes: mode off" : s.config.mode === "deny-once" ? "denied once, a retry within 10 minutes passes" : out?.systemMessage ? "passes with a notice" : "asks";
    lines.push(`verdict: cross (${verdict.why}) -> ${effect}`);
  }
  return lines.join("\n");
}

function worktreesReport(opts) {
  const git = makeGit();
  const gh = opts.noGh ? null : makeGh();
  const dirs = opts.positional.length ? opts.positional.map((d) => resolve(d)) : [process.cwd()];
  const repos = [...new Set(dirs.flatMap((d) => findRepos(d, git)))];
  if (!repos.length) return "no git repository found at or under " + dirs.join(", ");
  return formatScan(repos.map((r) => scanRepo(r, { git, gh })), { gh: !!gh });
}

export async function main(argv, { env = namedEnv(process.env), stdout = process.stdout, stderr = process.stderr } = {}) {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === "hook") {
      let raw = "";
      try {
        raw = readFileSync(0, "utf8");
      } catch {}
      const out = runHook({ raw, env });
      if (out) stdout.write(JSON.stringify(out) + "\n");
      return 0;
    }
    if (cmd === "directory-added") {
      try {
        recordDirectoryAdded(JSON.parse(readFileSync(0, "utf8")), env);
      } catch {}
      return 0;
    }
    if (cmd === "session-start") {
      try {
        pruneSessionRecords(env);
      } catch {}
      const out = sessionStart(process.versions.node);
      if (out) stdout.write(JSON.stringify(out) + "\n");
      return 0;
    }
    if (cmd === "explain") {
      stdout.write(explain(parseArgs(rest), env) + "\n");
      return 0;
    }
    if (cmd === "status") {
      stdout.write(describeSession(parseArgs(rest), env).lines.join("\n") + "\n");
      return 0;
    }
    if (cmd === "worktrees") {
      stdout.write(worktreesReport(parseArgs(rest)) + "\n");
      return 0;
    }
    if (cmd === "--version" || cmd === "version") {
      stdout.write(`${version}\n`);
      return 0;
    }
    if (cmd === "help" || cmd === "--help" || cmd === "-h") {
      stdout.write(usage + "\n");
      return 0;
    }
  } catch (e) {
    stderr.write(`${pluginName}: ${e.message}\n\n${usage}\n`);
    return 2;
  }
  stderr.write(`${usage}\n`);
  return 2;
}
