import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { NAME } from "./constants.mjs";

const PROMPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TOKENS = 4000;
const MAX_PROMPT_CHARS = 200000;
const KEY_PATTERN = /"([A-Za-z_][A-Za-z0-9_.-]{2,})"\s*:/g;

function promptDir(env) {
  return isAbsolute(env.CLAUDE_PLUGIN_DATA || "") ? join(env.CLAUDE_PLUGIN_DATA, "prompts") : "";
}

function recordPath(env, sessionId) {
  const dir = promptDir(env);
  if (!dir || typeof sessionId !== "string" || sessionId === "") return "";
  return join(dir, createHash("sha1").update(sessionId).digest("hex") + ".json");
}

export function hashToken(token) {
  return createHash("sha256").update(`${NAME}\u0000${token}`).digest("hex").slice(0, 24);
}

export function promptTokens(text) {
  const out = new Set();
  const add = (t) => {
    const w = t.replace(/^[.\/~-]+/, "").replace(/[.\/:-]+$/, "");
    if (w.length >= 3) out.add(w);
  };
  for (const raw of String(text).slice(0, MAX_PROMPT_CHARS).toLowerCase().split(/[^a-z0-9_.\/~-]+/)) {
    if (!raw) continue;
    add(raw);
    if (raw.includes("/")) {
      add(basename(raw));
      for (const part of raw.split("/")) add(part);
    }
    if (out.size >= MAX_TOKENS) break;
  }
  return [...out];
}

export function shouldRecord(input, config) {
  return input?.permission_mode === "bypassPermissions" && config?.profile !== "strict" && !config?.bypassStrict;
}

export function recordPrompt(input, env, config, now = Date.now()) {
  const p = recordPath(env, input?.session_id);
  if (!p) return false;
  if (!shouldRecord(input, config) || typeof input?.prompt !== "string" || typeof input?.prompt_id !== "string" || input.prompt_id === "") {
    rmSync(p, { force: true });
    return false;
  }
  prunePromptRecords(env, now);
  mkdirSync(promptDir(env), { recursive: true, mode: 0o700 });
  const body = JSON.stringify({ promptId: input.prompt_id, time: new Date(now).toISOString(), tokens: promptTokens(input.prompt).map(hashToken) });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, p);
  return true;
}

export function prunePromptRecords(env, now = Date.now()) {
  const dir = promptDir(env);
  if (!dir) return;
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const p = join(dir, name);
    try {
      if (now - statSync(p).mtimeMs > PROMPT_TTL_MS) rmSync(p, { force: true });
    } catch {}
  }
}

function changedKeys(toolInput) {
  const texts = [];
  if (typeof toolInput?.new_string === "string") texts.push(toolInput.new_string);
  if (Array.isArray(toolInput?.edits)) for (const e of toolInput.edits) if (typeof e?.new_string === "string") texts.push(e.new_string);
  if (typeof toolInput?.command === "string") texts.push(toolInput.command);
  const keys = new Set();
  for (const t of texts) for (const m of t.matchAll(KEY_PATTERN)) keys.add(m[1].toLowerCase());
  return [...keys];
}

export function settingsCandidates(target, toolInput) {
  const out = new Set();
  if (typeof target === "string" && target) {
    out.add(basename(target).toLowerCase());
    out.add(target.toLowerCase().replace(/^[.\/~-]+/, ""));
  }
  for (const k of changedKeys(toolInput)) out.add(k);
  return [...out];
}

export function promptNames(input, env, target) {
  const p = recordPath(env, input?.session_id);
  if (!p || typeof input?.prompt_id !== "string" || input.prompt_id === "") return false;
  let rec;
  try {
    rec = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return false;
  }
  if (!rec || rec.promptId !== input.prompt_id || !Array.isArray(rec.tokens)) return false;
  const have = new Set(rec.tokens);
  return settingsCandidates(target, input.tool_input).some((c) => have.has(hashToken(c)));
}
