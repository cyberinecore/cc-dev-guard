import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ALLOWED_DIRS_SHOWN, NAME, REPO_CONFIG_FILE, RETRY_WINDOW_MS } from "./constants.mjs";

const pluginName = NAME;
const repoConfigFile = REPO_CONFIG_FILE;
const retryMinutes = RETRY_WINDOW_MS / 60000;

const ALWAYS_ASK = new Set(["config-file", "settings-file", "transcript", "devguard-data", "protected", "invalid-path", "unresolvable"]);

function decision(permissionDecision, reason) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason: reason } };
}

export function describeDirs(dirs) {
  if (!dirs || dirs.length === 0) return "none";
  const shown = dirs.slice(0, ALLOWED_DIRS_SHOWN).map((d) => `\`${d}\``);
  const extra = dirs.length - shown.length;
  return shown.join(", ") + (extra > 0 ? ` and ${extra} more` : "");
}

function scopeText(v) {
  const repo = v.sessionTop ? `\`${v.sessionTop}\`` : "this session's repository";
  if (v.allowed && !v.allowed.ok) return `outside this session's repository ${repo}, and the session's allowed directories could not be read (${v.allowed.reason})`;
  const note = v.allowed?.transcriptReason ? `; the transcript could not be read (${v.allowed.transcriptReason}), so the list comes from settings, /add-dir and --add-dir` : "";
  return `outside this session's repository ${repo} and its allowed directories (${describeDirs(v.allowed?.dirs)}${note})`;
}

function withWarnings(text, warnings) {
  return warnings && warnings.length ? `${text} Config warnings: ${warnings.join("; ")}.` : text;
}

function alwaysAskReason(v) {
  switch (v.why) {
    case "config-file":
      return `${pluginName}: \`${v.target}\` is a ${pluginName} configuration file, and a change there changes what this guard allows. Approve only if you asked for this change.`;
    case "settings-file":
      return `${pluginName}: \`${v.target}\` is a Claude Code settings file, and a change there can widen what this session may write (additionalDirectories, env, hooks). Approve only if you asked for this change.`;
    case "transcript":
      return `${pluginName}: \`${v.target}\` is a Claude Code session transcript, which ${pluginName} reads to learn the session's allowed directories. Approve only if you asked for this change.`;
    case "devguard-data":
      return `${pluginName}: \`${v.target}\` is inside ${pluginName}'s own data directory, which records the directories this session added. Approve only if you asked for this change.`;
    case "protected":
      return `${pluginName}: \`${v.target}\` is under a path this repository protects in .claude/${repoConfigFile}. Approve only if you meant to change it.`;
    default:
      return `${pluginName}: could not resolve the path \`${v.target}\`, so it could not check whether this write stays inside the session's scope. Approve only if you expected this write.`;
  }
}

export function fixHint(v) {
  const dir = dirname(v.resolved || v.target);
  return `To allow it, the user can run \`/add-dir ${dir}\` for this session, or add \`${dir}\` to the ${pluginName} option extra_allowed_dirs (/config) for every session; a path the other repository gitignores also passes.`;
}

function worktreeScope(v) {
  return `in another worktree of this repository (\`${v.targetTop}\`), outside this session's worktree \`${v.sessionTop}\`, and the isolate_worktrees option is on`;
}

function via(v) {
  return v.via ? ` (written by a Bash ${v.via})` : "";
}

export function askReason(v) {
  if (v.why === "other-worktree") return `${pluginName}: \`${v.target}\`${via(v)} is ${worktreeScope(v)}. Approve only if you want this session to write there. ${fixHint(v)} If nobody can answer this prompt, report the write to the user instead of retrying it another way.`;
  const where = v.targetTop ? ` (\`${v.targetTop}\`)` : "";
  return `${pluginName}: \`${v.target}\`${via(v)} is in another repository${where}, ${scopeText(v)}. Approve only if you want this session to write there. ${fixHint(v)} If nobody can answer this prompt, report the write to the user instead of retrying it another way.`;
}

export function denyReason(v) {
  return `Default: NO. \`${v.target}\`${via(v)} is ${v.why === "other-worktree" ? worktreeScope(v) : scopeText(v)}. Retry only if the user explicitly names that target this turn; otherwise report instead. ${fixHint(v)} (${pluginName} deny-once: a retry within ${retryMinutes} minutes passes.)`;
}

function markerName(input, v) {
  const key = `${input?.session_id ?? ""}\u0000${v.targetRepo || v.target}`;
  return createHash("sha1").update(key).digest("hex");
}

function pruneMarkers(markerDir, now) {
  let entries;
  try {
    entries = readdirSync(markerDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    const p = join(markerDir, e.name);
    try {
      if (now - statSync(p).mtimeMs >= RETRY_WINDOW_MS) rmSync(p, { force: true });
    } catch {}
  }
}

function denyOnce(v, { input, now, markerDir, warnings }) {
  const marker = join(markerDir, markerName(input, v));
  try {
    if (now - statSync(marker).mtimeMs < RETRY_WINDOW_MS) return null;
  } catch {}
  pruneMarkers(markerDir, now);
  try {
    mkdirSync(markerDir, { recursive: true, mode: 0o700 });
    writeFileSync(marker, "", { mode: 0o600 });
    const t = new Date(now);
    utimesSync(marker, t, t);
  } catch {}
  return decision("deny", withWarnings(denyReason(v), warnings));
}

const bypassNote = `This session runs with bypassPermissions, where Claude Code lets an ask through for some paths (measured on .claude/, .git/, .vscode/, shell and git config files and .mcp.json), so ${pluginName} denies instead. Follow the fix named above, or let the user make the change.`;

function askOrDeny(input, reason) {
  if (input?.permission_mode === "bypassPermissions") return decision("deny", `${reason} ${bypassNote}`);
  return decision("ask", reason);
}

export function render(v, { mode, input, now = Date.now(), markerDir, warnings = [] } = {}) {
  if (!v || v.action !== "cross" || mode === "off") return null;
  if (ALWAYS_ASK.has(v.why)) return askOrDeny(input, withWarnings(alwaysAskReason(v), warnings));
  switch (mode) {
    case "warn":
      return { systemMessage: withWarnings(`${pluginName} (warn mode): a write to \`${v.target}\` is ${scopeText(v)}. It was not blocked.`, warnings) };
    case "deny-once":
      return denyOnce(v, { input, now, markerDir, warnings });
    default:
      return askOrDeny(input, withWarnings(askReason(v), warnings));
  }
}

export function dangerDenyReason(reason, escapeName) {
  return `${pluginName}: ${reason} ${pluginName} denies this in every permission mode. Hand the exact command to the user to run themselves, or the user starts the session with ${escapeName}=1.`;
}

export function renderDanger(reason, { escapeName, warnings = [] } = {}) {
  return decision("deny", withWarnings(dangerDenyReason(reason, escapeName), warnings));
}

export function renderError(error, input) {
  const msg = error && error.message ? error.message : String(error);
  return askOrDeny(input, `${pluginName} could not check this write (${msg}), so it cannot tell whether the write stays inside the session's scope. Approve only if you expected this write.`);
}

export function worktreeReason(v) {
  if (v.why === "worktree-unresolved") {
    return `${pluginName}: this command runs \`git worktree add\`, and ${pluginName} could not resolve ${v.detail}, so it cannot tell where the worktree lands. Worktrees belong under the repository's \`.claude/worktrees/\`. Approve only if you expected this worktree.`;
  }
  if (v.why === "worktree-nested") {
    return `${pluginName}: this command runs \`git worktree add\` for \`${v.target}\`, inside the existing worktree \`${v.host}\`. Nested worktrees end up inside each other's checkouts; put it directly under \`${v.worktreesDir}\`. Approve only if you want it nested there.`;
  }
  return `${pluginName}: this command runs \`git worktree add\` for \`${v.target}\`, outside \`${v.worktreesDir}\`. A worktree elsewhere (a /tmp folder above all) is easy to lose: the folder goes away and a stale worktree record stays behind. Prefer the Agent tool's isolation "worktree" or EnterWorktree, which place worktrees under \`${v.worktreesDir}\`, or stay in this checkout and use a scratch directory. Approve only if you want a worktree at that path.`;
}

export function renderWorktree(v, { mode, input, warnings = [] } = {}) {
  if (!v || v.action !== "cross" || mode === "off") return null;
  const reason = withWarnings(worktreeReason(v), warnings);
  if (mode === "warn") return { systemMessage: `${pluginName} (warn mode): ${reason}` };
  return askOrDeny(input, reason);
}
