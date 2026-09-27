import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";

export function realPathOr(p) {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
}

export function existingAncestor(dir) {
  let cur = dir;
  for (;;) {
    try {
      if (statSync(cur).isDirectory()) return cur;
    } catch {}
    const parent = dirname(cur);
    if (parent === cur) return "";
    cur = parent;
  }
}

export function resolveThroughAncestor(p) {
  const clean = normalize(p);
  const dir = existingAncestor(dirname(clean));
  if (!dir) return null;
  const rest = relative(dir, clean);
  const real = realPathOr(dir);
  return { dir: real, resolved: rest ? join(real, rest) : real };
}

export function resolveDir(d) {
  if (typeof d !== "string" || !isAbsolute(d)) return "";
  try {
    return realpathSync.native(d);
  } catch {}
  const r = resolveThroughAncestor(stripTrailingSep(d));
  return r ? r.resolved : normalize(d);
}

export function stripTrailingSep(p) {
  let out = p;
  while (out.length > 1 && (out.endsWith("/") || out.endsWith(sep))) out = out.slice(0, -1);
  return out;
}

export function isUnder(path, dir) {
  if (!path || !dir) return false;
  const d = stripTrailingSep(normalize(dir));
  if (d === sep || d === "/") return path.startsWith(d);
  return path === d || path.startsWith(d + sep);
}

export function expandHome(p, home) {
  if (typeof p !== "string") return "";
  if (p === "~") return home || "";
  if (p.startsWith("~/")) return home ? join(home, p.slice(2)) : "";
  return p;
}
