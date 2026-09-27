import { strict as assert } from "node:assert";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readAllowedDirs } from "../scripts/lib/transcript.mjs";
import { envLine, tempDir, writeRaw, writeTranscript } from "./helpers.mjs";

function dirsOf(result) {
  assert.equal(result.ok, true, `want a snapshot, got unavailable: ${result.reason}`);
  return result.dirs;
}

function unavailable(name, result) {
  assert.equal(result.ok, false, `${name}: want unavailable, got ${JSON.stringify(result)}`);
  assert.equal(typeof result.reason, "string");
}

test("the latest snapshot wins", () => {
  const d = tempDir();
  assert.deepEqual(dirsOf(readAllowedDirs(writeTranscript(envLine(d), envLine()))), []);
  assert.deepEqual(dirsOf(readAllowedDirs(writeTranscript(envLine(), envLine(d)))), [d]);
});

test("absent or unusable transcripts are unavailable, never an empty grant", () => {
  const root = tempDir();
  unavailable("empty path", readAllowedDirs(""));
  unavailable("relative path", readAllowedDirs("session.jsonl"));
  unavailable("missing file", readAllowedDirs(join(root, "absent.jsonl")));
  unavailable("directory", readAllowedDirs(root));
  unavailable("empty file", readAllowedDirs(writeRaw("")));
  unavailable("no snapshot", readAllowedDirs(writeTranscript(`{"type":"user","message":{"content":"hi"}}`)));
  unavailable("malformed snapshot line", readAllowedDirs(writeTranscript(`{"type":"attachment","attachment":{"type":"environment","snapshot":{`)));
});

test("a partial final line falls back to the previous snapshot", () => {
  const d = tempDir();
  const partial = `{"type":"attachment","attachment":{"type":"environment","snapshot":{"additionalWorkingDirectories":[`;
  assert.deepEqual(dirsOf(readAllowedDirs(writeRaw(envLine(d) + "\n" + partial))), [d]);
  unavailable("partial final line alone", readAllowedDirs(writeRaw(`{"type":"attachment","attachment":{"type":"environment","snapshot":{"additionalWorkingDirectories":["${d}"`)));
});

test("a final line without a trailing newline still counts", () => {
  const d = tempDir();
  assert.deepEqual(dirsOf(readAllowedDirs(writeRaw(envLine(d)))), [d]);
});

test("look-alikes of a snapshot are ignored", () => {
  const d = tempDir();
  const quoted = JSON.stringify({ type: "user", message: { content: envLine(d) } });
  unavailable("snapshot text quoted inside a message", readAllowedDirs(writeTranscript(quoted)));
  const nested = JSON.stringify({ type: "user", toolUseResult: { type: "environment", snapshot: { additionalWorkingDirectories: [d] } } });
  unavailable("environment-shaped object that is not an attachment", readAllowedDirs(writeTranscript(nested)));
  const wrongTop = JSON.stringify({ type: "user", attachment: { type: "environment", snapshot: { additionalWorkingDirectories: [d] } } });
  unavailable("attachment block on a non-attachment line", readAllowedDirs(writeTranscript(wrongTop)));
  const wrongKind = JSON.stringify({ type: "attachment", attachment: { type: "file", snapshot: { additionalWorkingDirectories: [d] } }, extra: { type: "environment" } });
  unavailable("attachment of another kind", readAllowedDirs(writeTranscript(wrongKind)));
  const notArray = JSON.stringify({ type: "attachment", attachment: { type: "environment", snapshot: { additionalWorkingDirectories: d } } });
  unavailable("additionalWorkingDirectories that is not an array", readAllowedDirs(writeTranscript(notArray)));
  const older = envLine(d);
  assert.deepEqual(dirsOf(readAllowedDirs(writeTranscript(older, quoted, nested))), [d], "look-alikes after a real snapshot do not hide it");
});

test("a line over 5 MB and a snapshot megabytes from EOF resolve", () => {
  const d = tempDir();
  const big = `{"type":"user","message":{"content":"${"z".repeat(5.5 * 1024 * 1024)}"}}`;
  assert.deepEqual(dirsOf(readAllowedDirs(writeTranscript(big, envLine(d), big, big))), [d]);
  assert.deepEqual(dirsOf(readAllowedDirs(writeTranscript(envLine(d), big))), [d]);
});

test("a marker split across a chunk boundary is found", () => {
  const d = tempDir();
  const line = envLine(d);
  for (const chunkSize of [7, 16, 64, 1000]) {
    const pad = "p".repeat(chunkSize * 3);
    const p = writeTranscript(`{"type":"user","message":{"content":"${pad}"}}`, line, `{"type":"user","message":{"content":"${pad}"}}`);
    assert.deepEqual(dirsOf(readAllowedDirs(p, { chunkSize })), [d], `chunkSize ${chunkSize}`);
  }
});

test("the scan budget bounds how far back the reader looks", () => {
  const d = tempDir();
  const filler = `{"type":"user","message":{"content":"${"y".repeat(4096)}"}}`;
  const p = writeTranscript(envLine(d), ...Array(64).fill(filler));
  unavailable("snapshot beyond the budget", readAllowedDirs(p, { scanBudget: 16 * 1024 }));
  assert.deepEqual(dirsOf(readAllowedDirs(p, { scanBudget: 1024 * 1024 })), [d]);
});

test("an oversized line carrying the marker is skipped, not parsed", () => {
  const d = tempDir();
  const hugeSnapshot = JSON.stringify({ type: "attachment", attachment: { type: "environment", snapshot: { additionalWorkingDirectories: [d], pad: "q".repeat(64 * 1024) } } });
  const p = writeTranscript(envLine(), hugeSnapshot);
  assert.deepEqual(dirsOf(readAllowedDirs(p, { maxLineBytes: 16 * 1024 })), [], "falls back to the earlier snapshot");
});

test("CRLF line endings parse", () => {
  const d = tempDir();
  assert.deepEqual(dirsOf(readAllowedDirs(writeRaw(`{"type":"user"}\r\n${envLine(d)}\r\n`))), [d]);
});

test("entries are resolved: symlinks, trailing slashes, missing dirs, relative entries dropped", () => {
  const root = tempDir();
  const real = join(root, "real");
  mkdirSync(real);
  const alias = join(root, "alias");
  symlinkSync(real, alias);
  const missing = join(real, "not", "yet");
  const dirs = dirsOf(readAllowedDirs(writeTranscript(envLine(alias, real + "/", missing, "relative/dir", ""))));
  assert.deepEqual(dirs, [real, real, missing]);
});
