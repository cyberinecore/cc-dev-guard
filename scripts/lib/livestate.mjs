import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { FALLBACK_MARKER_DIR } from "./constants.mjs";

export const RELAUNCH_WINDOW_MS = 60 * 60 * 1000;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NAMES = 200;

export function liveStateDir(env) {
  return isAbsolute(env.CLAUDE_PLUGIN_DATA || "") ? join(env.CLAUDE_PLUGIN_DATA, "live") : join(tmpdir(), `${FALLBACK_MARKER_DIR}-live`);
}

function fileFor(dir, sessionId) {
  return join(dir, createHash("sha1").update(String(sessionId)).digest("hex") + ".json");
}

export function loadLiveState(dir, sessionId) {
  const empty = { owned: [], launches: {} };
  if (!sessionId) return empty;
  try {
    const data = JSON.parse(readFileSync(fileFor(dir, sessionId), "utf8"));
    return {
      owned: Array.isArray(data.owned) ? data.owned.filter((n) => typeof n === "string") : [],
      launches: data.launches && typeof data.launches === "object" ? data.launches : {},
    };
  } catch {
    return empty;
  }
}

export function saveLiveState(dir, sessionId, state, now = Date.now()) {
  if (!sessionId) return;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = fileFor(dir, sessionId);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ owned: state.owned.slice(-MAX_NAMES), launches: state.launches }), { mode: 0o600 });
    renameSync(tmp, target);
    pruneLiveState(dir, now);
  } catch {}
}

function pruneLiveState(dir, now) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    const p = join(dir, e.name);
    try {
      if (now - statSync(p).mtimeMs >= KEEP_MS) rmSync(p, { force: true });
    } catch {}
  }
}

export function countLaunches(state, apps, now) {
  const counts = [];
  for (const app of apps) {
    const key = app.toLowerCase();
    const recent = (Array.isArray(state.launches[key]) ? state.launches[key] : []).filter((t) => typeof t === "number" && now - t < RELAUNCH_WINDOW_MS);
    recent.push(now);
    state.launches[key] = recent;
    counts.push({ app, count: recent.length });
  }
  for (const key of Object.keys(state.launches)) {
    if (!state.launches[key].some((t) => now - t < RELAUNCH_WINDOW_MS)) delete state.launches[key];
  }
  return counts;
}
