import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { ALLOWED_DIRS_SHOWN, NAME, REPO_CONFIG_FILE, RETRY_WINDOW_MS } from "./constants.mjs";
import { isUncertainDanger } from "./dangerguard.mjs";

const pluginName = NAME;
const repoConfigFile = REPO_CONFIG_FILE;
const retryMinutes = RETRY_WINDOW_MS / 60000;

const ALWAYS_ASK = new Set(["config-file", "settings-file", "transcript", "devguard-data", "protected", "invalid-path", "unresolvable"]);
export const GUARDED_FILE_WHYS = new Set(["config-file", "settings-file", "transcript", "devguard-data", "protected"]);
const ALWAYS_ASK_FILES = new Set(["config-file", "settings-file", "transcript", "devguard-data"]);

const isBypass = (input) => input?.permission_mode === "bypassPermissions";

export function defersToAuto(profile, input) {
  return profile !== "strict" && input?.permission_mode === "auto";
}

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

function alwaysAskWhat(v) {
  switch (v.why) {
    case "config-file":
      return `${pluginName}: \`${v.target}\`${via(v)} is a ${pluginName} configuration file, and a change there changes what this guard allows.`;
    case "settings-file":
      return `${pluginName}: \`${v.target}\`${via(v)} is a Claude Code settings file, and a change there can widen what later sessions may do (hooks, permissions, additionalDirectories, env).`;
    case "transcript":
      return `${pluginName}: \`${v.target}\`${via(v)} is a Claude Code session transcript, which ${pluginName} reads to learn the session's allowed directories.`;
    case "devguard-data":
      return `${pluginName}: \`${v.target}\`${via(v)} is inside ${pluginName}'s own data directory, which records the directories this session added.`;
    case "protected":
      return `${pluginName}: \`${v.target}\`${via(v)} is under a path this repository protects in .claude/${repoConfigFile}.`;
    default:
      return `${pluginName}: could not resolve the path \`${v.target}\`, so it could not check whether this write stays inside the session's scope.`;
  }
}

function alwaysAskApprove(v) {
  if (v.why === "protected") return "Approve only if you meant to change it.";
  if (ALWAYS_ASK_FILES.has(v.why)) return "Approve only if you asked for this change.";
  return "Approve only if you expected this write.";
}

function insideWorkingDir(v) {
  const root = v.sessionRoot || "";
  if (!v.targetTop || !root || v.targetTop === root) return false;
  const top = root.endsWith(sep) ? root : root + sep;
  return v.targetTop.startsWith(top);
}

export function fixHint(v) {
  if (v.why !== "other-worktree" && insideWorkingDir(v)) {
    return `To allow it, the user can open /config, find the ${pluginName} options, and add \`${v.sessionTop}\` to hub_repos to cover this repository's submodules, or \`${v.targetTop}\` to extra_allowed_dirs to cover just this one; both last across sessions. \`/add-dir\` does not help here: for a folder inside the working directory, Claude Code 2.1.312 only loads its skills and grants no write access.`;
  }
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

function markerName(input, key) {
  return createHash("sha1").update(`${input?.session_id ?? ""}\u0000${key}`).digest("hex");
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

function firstTry(key, { input, now, markerDir }) {
  const marker = join(markerDir, markerName(input, key));
  try {
    if (now - statSync(marker).mtimeMs < RETRY_WINDOW_MS) return false;
  } catch {}
  pruneMarkers(markerDir, now);
  try {
    mkdirSync(markerDir, { recursive: true, mode: 0o700 });
    writeFileSync(marker, "", { mode: 0o600 });
    const t = new Date(now);
    utimesSync(marker, t, t);
  } catch {}
  return true;
}

function denyOnce(v, { input, now, markerDir, warnings, note = "" }) {
  if (!firstTry(v.targetRepo || v.target, { input, now, markerDir })) return null;
  return decision("deny", withWarnings(note ? `${denyReason(v)} ${note}` : denyReason(v), warnings));
}

const bypassNote = `This session runs with bypassPermissions, where Claude Code lets an ask through for some paths (measured on .claude/, .git/, .vscode/, shell and git config files and .mcp.json), so ${pluginName} denies instead. Hand the exact change to the user to run themselves (a \`!\` command in the prompt), or the user makes it in a session without bypassPermissions, where this asks.`;

const settingsOnceNote = `The user's current prompt names neither this file nor a key the change sets. Retry the identical change within ${retryMinutes} minutes only if the user asked for it in this conversation; otherwise report it to the user instead. (${pluginName} deny-once for settings files under bypassPermissions; profile strict or the bypass_strict option keeps it denied.)`;

const bypassOnceNote = `This session runs with bypassPermissions, where no prompt reaches the user, so ${pluginName} holds the first write to that repository and lets a retry through; the user can turn on the bypass_strict option to keep every such write denied.`;

function askOrDeny(input, what, approve, warnings = []) {
  if (input?.permission_mode === "bypassPermissions") return decision("deny", withWarnings(`${what} ${bypassNote}`, warnings));
  return decision("ask", withWarnings(approve ? `${what} ${approve}` : what, warnings));
}

function settingsKey(v, input) {
  return `settings\u0000${v.resolved || v.target}\u0000${createHash("sha1").update(JSON.stringify(input?.tool_input ?? null)).digest("hex")}`;
}

function renderSettingsBypass(v, { input, now, markerDir, warnings, promptNamed }) {
  if (promptNamed) return null;
  if (!firstTry(settingsKey(v, input), { input, now, markerDir })) return null;
  return decision("deny", withWarnings(`Default: NO. ${alwaysAskWhat(v)} ${settingsOnceNote}`, warnings));
}

export function render(v, { mode, input, now = Date.now(), markerDir, warnings = [], bypassStrict = false, profile = "assist", promptNamed = false } = {}) {
  if (!v || v.action !== "cross" || mode === "off") return null;
  if (v.why === "settings-file" && isBypass(input) && profile !== "strict" && !bypassStrict) return renderSettingsBypass(v, { input, now, markerDir, warnings, promptNamed });
  if (ALWAYS_ASK.has(v.why)) return askOrDeny(input, alwaysAskWhat(v), alwaysAskApprove(v), warnings);
  if (mode === "ask" && defersToAuto(profile, input)) return null;
  switch (mode) {
    case "warn":
      return { systemMessage: withWarnings(`${pluginName} (warn mode): a write to \`${v.target}\` is ${scopeText(v)}. It was not blocked.`, warnings) };
    case "deny-once":
      return denyOnce(v, { input, now, markerDir, warnings });
    default:
      if (input?.permission_mode === "bypassPermissions" && !bypassStrict) return denyOnce(v, { input, now, markerDir, warnings, note: bypassOnceNote });
      return askOrDeny(input, askReason(v), "", warnings);
  }
}

export function dangerDenyReason(reason, escapeName) {
  return `${pluginName}: ${reason} ${pluginName} denies this in every permission mode. Hand the exact command to the user to run themselves, or the user starts the session with ${escapeName}=1.`;
}

function renderUncertain(reason, { input, escapeName, warnings, now, markerDir, bypassStrict, key }) {
  if (defersToAuto("assist", input)) return null;
  if (!isBypass(input)) return decision("ask", withWarnings(`${pluginName}: ${reason} ${pluginName} could not prove this loses data, so it asks instead of denying. Approve only if you expected it.`, warnings));
  if (bypassStrict) return decision("deny", withWarnings(dangerDenyReason(reason, escapeName), warnings));
  if (!firstTry(`danger\u0000${key}`, { input, now, markerDir })) return null;
  return decision("deny", withWarnings(`Default: NO. ${pluginName}: ${reason} ${pluginName} could not prove this loses data. Check the target first (print the variable, or write the literal path); retry the same command only if it is what you meant. (${pluginName} deny-once under bypassPermissions: the same command retried within ${retryMinutes} minutes passes; the bypass_strict option or profile strict keeps it denied.)`, warnings));
}

function uncertainKey(input) {
  return `${input?.cwd ?? ""}\u0000${input?.tool_input?.command ?? ""}`;
}

export function renderDanger(reason, { input, escapeName, warnings = [], profile = "assist", now = Date.now(), markerDir, bypassStrict = false } = {}) {
  if (profile !== "strict" && isUncertainDanger(reason)) return renderUncertain(reason, { input, escapeName, warnings, now, markerDir, bypassStrict, key: uncertainKey(input) });
  return decision("deny", withWarnings(dangerDenyReason(reason, escapeName), warnings));
}

export function renderDangerAsk(reason, { input, escapeName, warnings = [], profile = "assist", now = Date.now(), markerDir, bypassStrict = false } = {}) {
  if (profile !== "strict" && isUncertainDanger(reason)) return renderUncertain(reason, { input, escapeName, warnings, now, markerDir, bypassStrict, key: uncertainKey(input) });
  if (input?.permission_mode === "bypassPermissions") return decision("deny", withWarnings(`${pluginName}: ${reason} This session runs with bypassPermissions, where no prompt reaches the user, so danger_guard denies it. Take the safer route named above, or hand the exact command to the user to run themselves; the user can start the session with ${escapeName}=1.`, warnings));
  return decision("ask", withWarnings(`${pluginName}: ${reason}`, warnings));
}

export function renderError(error, input) {
  const msg = error && error.message ? error.message : String(error);
  return askOrDeny(input, `${pluginName} could not check this write (${msg}), so it cannot tell whether the write stays inside the session's scope.`, "Approve only if you expected this write.");
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

export function renderWorktree(v, { mode, input, warnings = [], profile = "assist" } = {}) {
  if (!v || v.action !== "cross" || mode === "off") return null;
  if (mode === "ask" && defersToAuto(profile, input)) return null;
  const reason = withWarnings(worktreeReason(v), warnings);
  if (mode === "warn") return { systemMessage: `${pluginName} (warn mode): ${reason}` };
  return askOrDeny(input, reason);
}

export function renderLive(f, { input, now = Date.now(), markerDir, warnings = [], bypassStrict = false, escapeName, profile = "assist" } = {}) {
  if (!f) return null;
  if (f.level !== "deny" && defersToAuto(profile, input)) return null;
  if (f.level === "deny") {
    return decision("deny", withWarnings(`${pluginName}: ${f.reason} live_guard denies this in every permission mode, because it disrupts the user's running machine beyond this session's own work. Stop only a process this session started, by its PID, or hand the exact command to the user to run themselves; the user can start the session with ${escapeName}=1.`, warnings));
  }
  if (input?.permission_mode === "bypassPermissions") {
    if (f.hard || bypassStrict) return decision("deny", withWarnings(`${pluginName}: ${f.reason} This session runs with bypassPermissions, where no prompt reaches the user, so live_guard denies it. Report the command to the user instead of running it another way.`, warnings));
    if (!firstTry(`live\u0000${f.key}`, { input, now, markerDir })) return null;
    return decision("deny", withWarnings(`Default: NO. ${pluginName}: ${f.reason} Retry only if the user explicitly asked for this command this turn; otherwise report it to the user instead. (${pluginName} live_guard deny-once under bypassPermissions: a retry within ${retryMinutes} minutes passes.)`, warnings));
  }
  return decision("ask", withWarnings(`${pluginName}: ${f.reason} It changes the user's running machine outside this session's own work. Approve only if you asked for it.`, warnings));
}
