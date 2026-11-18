import { splitSegments } from "./dangerguard.mjs";

const UNSAFE_TAIL = /\$\(|`|[<>]/;
const FD_COPY = /\d?>&\d/g;

export function parseAllowCommands(raw, optionName, warnings) {
  if (raw === undefined || raw === "") return [];
  const out = [];
  for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const wildcard = entry.endsWith("*");
    const body = wildcard ? entry.slice(0, -1) : entry;
    if (body.trim() === "") {
      warnings.push(`option ${optionName}: "${entry}" lists no command; ignored`);
      continue;
    }
    if (wildcard && body.includes("*")) {
      warnings.push(`option ${optionName}: "${entry}" has a * before the end; only one trailing * is a pattern; ignored`);
      continue;
    }
    const segments = splitSegments(body);
    if (segments.length !== 1) {
      warnings.push(`option ${optionName}: "${entry}" chains commands; list each command on its own; ignored`);
      continue;
    }
    out.push(wildcard ? { text: null, prefix: body } : { text: entry, prefix: null });
  }
  return out;
}

export function commandAllowed(command, entries) {
  if (!Array.isArray(entries) || !entries.length || typeof command !== "string") return false;
  const segments = splitSegments(command).map((p) => p.text.trim()).filter(Boolean);
  if (!segments.length) return false;
  return segments.every((s) => entries.some((e) => (e.prefix === null ? s === e.text : s.startsWith(e.prefix) && safeTail(e.prefix, s.slice(e.prefix.length)))));
}

const PATH_BINS = new Set(["rm", "rmdir", "unlink", "mv", "cp", "find", "rsync", "trash", "shred", "chmod", "chown", "ln", "truncate"]);
const reDotDot = /(^|[\s/="'])\.\.(?=$|[\s/"'])/;

function safeTail(prefix, tail) {
  if (UNSAFE_TAIL.test(tail.replace(FD_COPY, ""))) return false;
  if (reDotDot.test(tail)) return false;
  const bin = prefix.trim().split(/\s+/).find((w) => !/^(sudo|env|command|nohup|time|exec)$/.test(w) && !/^\w+=/.test(w)) || "";
  if (PATH_BINS.has(bin.replace(/^.*\//, "")) && /\s/.test(tail)) return false;
  return true;
}

export function normalizeAppName(name) {
  return String(name).trim().replace(/\.app\/?$/i, "").toLowerCase();
}

export function parseAppList(raw) {
  if (raw === undefined || raw === "") return [];
  return raw.split(",").map(normalizeAppName).filter(Boolean);
}

export function isExemptApp(app, exempt) {
  return Array.isArray(exempt) && exempt.length > 0 && exempt.includes(normalizeAppName(app));
}
