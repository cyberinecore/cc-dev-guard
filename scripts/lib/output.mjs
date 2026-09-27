import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ALLOWED_DIRS_SHOWN, NAME, RETRY_WINDOW_MS } from "./constants.mjs";

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
      return `${NAME}: \`${v.target}\` is a ${NAME} configuration file, and a change there changes what this guard allows. Approve only if you asked for this change.`;
    case "settings-file":
      return `${NAME}: \`${v.target}\` is a Claude Code settings file, and a change there can widen what this session may write (additionalDirectories, env, hooks). Approve only if you asked for this change.`;
    case "transcript":
      return `${NAME}: \`${v.target}\` is a Claude Code session transcript, which ${NAME} reads to learn the session's allowed directories. Approve only if you asked for this change.`;
    case "devguard-data":
      return `${NAME}: \`${v.target}\` is inside ${NAME}'s own data directory, which records the directories this session added. Approve only if you asked for this change.`;
    case "protected":
      return `${NAME}: \`${v.target}\` is under a path this repository protects in .claude/${NAME}.json. Approve only if you meant to change it.`;
    default:
      return `${NAME}: could not resolve the path \`${v.target}\`, so it could not check whether this write stays inside the session's scope. Approve only if you expected this write.`;
  }
}

export function askReason(v) {
  const where = v.targetTop ? ` (\`${v.targetTop}\`)` : "";
  return `${NAME}: \`${v.target}\` is in another repository${where}, ${scopeText(v)}. Approve only if you want this session to write there. If nobody can answer this prompt, report the write to the user instead of retrying it another way.`;
}

export function denyReason(v) {
  return `Default: NO. \`${v.target}\` is ${scopeText(v)}. Retry only if the user explicitly names that target this turn; otherwise report instead. (${NAME} deny-once: a retry within ${RETRY_WINDOW_MS / 60000} minutes passes.)`;
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

const BYPASS_NOTE = `This session runs with bypassPermissions, where Claude Code lets an ask through for some paths (measured on .claude/, .git/, .vscode/ and dotfiles), so ${NAME} denies instead. To allow it, add the directory to the session with /add-dir, or let the user make the change.`;

function askOrDeny(input, reason) {
  if (input?.permission_mode === "bypassPermissions") return decision("deny", `${reason} ${BYPASS_NOTE}`);
  return decision("ask", reason);
}

export function render(v, { mode, input, now = Date.now(), markerDir, warnings = [] } = {}) {
  if (!v || v.action !== "cross" || mode === "off") return null;
  if (ALWAYS_ASK.has(v.why)) return askOrDeny(input, withWarnings(alwaysAskReason(v), warnings));
  switch (mode) {
    case "warn":
      return { systemMessage: withWarnings(`${NAME} (warn mode): a write to \`${v.target}\` is ${scopeText(v)}. It was not blocked.`, warnings) };
    case "deny-once":
      return denyOnce(v, { input, now, markerDir, warnings });
    default:
      return askOrDeny(input, withWarnings(askReason(v), warnings));
  }
}

export function renderError(error, input) {
  const msg = error && error.message ? error.message : String(error);
  return askOrDeny(input, `${NAME} could not check this write (${msg}), so it cannot tell whether the write stays inside the session's scope. Approve only if you expected this write.`);
}
