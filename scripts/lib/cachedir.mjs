import { closeSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

export const CACHEDIR_TAG = "CACHEDIR.TAG";
export const CACHEDIR_HEADER = "Signature: 8a477f597d28d172789f06886806bc55";

const realOrNull = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

export function isCacheDir(dir, { home = "" } = {}) {
  const real = realOrNull(dir);
  if (!real || real === sep || real.split(/[\\/]/).includes(".git")) return false;
  const realHome = home ? realOrNull(home) || home : "";
  if (realHome && (real === realHome || realHome.startsWith(real + sep))) return false;
  let fd;
  try {
    if (!lstatSync(real).isDirectory()) return false;
    const tag = join(real, CACHEDIR_TAG);
    if (!lstatSync(tag).isFile()) return false;
    fd = openSync(tag, "r");
    const buf = Buffer.alloc(CACHEDIR_HEADER.length);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return n === buf.length && buf.toString("latin1") === CACHEDIR_HEADER;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
