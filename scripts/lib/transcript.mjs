import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";
import { resolveDir } from "./paths.mjs";

const MARKER = Buffer.from('"type":"environment"');
const NEWLINE = 0x0a;

export const READER_DEFAULTS = Object.freeze({
  chunkSize: 256 * 1024,
  scanBudget: 256 * 1024 * 1024,
  maxLineBytes: 4 * 1024 * 1024,
});

function unavailable(reason) {
  return { ok: false, reason };
}

function snapshotDirs(line) {
  let end = line.length;
  if (end > 0 && line[end - 1] === 0x0d) end -= 1;
  let parsed;
  try {
    parsed = JSON.parse(line.subarray(0, end).toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || parsed.type !== "attachment") return null;
  const att = parsed.attachment;
  if (!att || typeof att !== "object" || att.type !== "environment") return null;
  const snap = att.snapshot;
  if (!snap || typeof snap !== "object" || !Array.isArray(snap.additionalWorkingDirectories)) return null;
  return snap.additionalWorkingDirectories;
}

export function resolveAllowedDirs(dirs) {
  const out = [];
  for (const d of dirs) {
    if (typeof d !== "string" || !isAbsolute(d)) continue;
    const r = resolveDir(d);
    if (r) out.push(r);
  }
  return out;
}

export function readAllowedDirs(transcriptPath, options = {}) {
  const { chunkSize, scanBudget, maxLineBytes } = { ...READER_DEFAULTS, ...options };
  if (typeof transcriptPath !== "string" || transcriptPath === "") return unavailable("the hook input has no transcript path");
  if (!isAbsolute(transcriptPath)) return unavailable("the transcript path is not absolute");
  let fd;
  try {
    fd = openSync(transcriptPath, "r");
  } catch (e) {
    return unavailable(`the transcript cannot be opened (${e.code || e.message})`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return unavailable("the transcript path is not a regular file");
    return scanBackwards(fd, st.size, { chunkSize, scanBudget, maxLineBytes });
  } catch (e) {
    return unavailable(`the transcript cannot be read (${e.code || e.message})`);
  } finally {
    closeSync(fd);
  }
}

function scanBackwards(fd, size, { chunkSize, scanBudget, maxLineBytes }) {
  const chunk = Buffer.alloc(Math.max(1, Math.min(chunkSize, size || 1)));
  let pieces = [];
  let pieceLen = 0;
  let overflow = false;

  const addPiece = (p) => {
    if (overflow || p.length === 0) return;
    if (pieceLen + p.length > maxLineBytes) {
      overflow = true;
      pieces = [];
      pieceLen = 0;
      return;
    }
    pieces.push(Buffer.from(p));
    pieceLen += p.length;
  };

  const finishLine = () => {
    const skipped = overflow;
    const parts = pieces;
    pieces = [];
    pieceLen = 0;
    overflow = false;
    if (skipped || parts.length === 0) return null;
    const line = parts.length === 1 ? parts[0] : Buffer.concat(parts.reverse());
    if (!line.includes(MARKER)) return null;
    const dirs = snapshotDirs(line);
    return dirs ? { ok: true, dirs: resolveAllowedDirs(dirs) } : null;
  };

  let pos = size;
  let read = 0;
  while (pos > 0) {
    if (read >= scanBudget) return unavailable(`no environment snapshot in the last ${scanBudget} bytes of the transcript`);
    const n = Math.min(chunk.length, pos, scanBudget - read);
    pos -= n;
    readSync(fd, chunk, 0, n, pos);
    read += n;
    let end = n;
    for (;;) {
      const nl = end > 0 ? chunk.lastIndexOf(NEWLINE, end - 1) : -1;
      addPiece(chunk.subarray(nl + 1, end));
      if (nl < 0) break;
      const found = finishLine();
      if (found) return found;
      end = nl;
    }
  }
  const found = finishLine();
  if (found) return found;
  return unavailable(size === 0 ? "the transcript is empty" : "no environment snapshot in the transcript");
}
