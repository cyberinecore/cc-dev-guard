import { isAbsolute, join, resolve } from "node:path";
import { isUnder, resolveDir } from "./paths.mjs";

const SEPARATORS = new Set([";", "&&", "||", "|", "&", "\n", "(", ")", "|&"]);
const PREFIX_WORDS = new Set(["command", "builtin", "exec", "nohup", "time", "env", "sudo", "doas"]);
const GIT_VALUE_OPTIONS = new Set(["-c", "--namespace", "--exec-path", "--config-env", "--super-prefix", "--list-cmds", "--attr-source"]);
const GIT_SCOPE_OPTIONS = new Set(["--git-dir", "--work-tree"]);
const ADD_VALUE_OPTIONS = new Set(["-b", "-B", "--reason"]);

export const WORKTREES_DIR = join(".claude", "worktrees");

export function mentionsWorktree(command) {
  return typeof command === "string" && command.includes("worktree");
}

export function tokenize(command) {
  const tokens = [];
  let word = null;
  let expectDelimiter = null;
  const heredocs = [];
  const startWord = () => {
    if (!word) word = { text: "", dynamic: false };
  };
  const endWord = () => {
    if (!word) return;
    tokens.push(word);
    if (expectDelimiter) {
      heredocs.push({ delimiter: word.text, strip: expectDelimiter.strip });
      expectDelimiter = null;
    }
    word = null;
  };
  const s = String(command);
  const skipHeredocs = (from) => {
    let pos = from;
    for (const h of heredocs.splice(0)) {
      for (;;) {
        if (pos >= s.length) return s.length;
        const nl = s.indexOf("\n", pos);
        const line = s.slice(pos, nl < 0 ? s.length : nl);
        pos = nl < 0 ? s.length : nl + 1;
        if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delimiter) break;
      }
    }
    return pos;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      if (s[i + 1] === "\n") {
        i++;
        continue;
      }
      startWord();
      if (i + 1 < s.length) word.text += s[++i];
      continue;
    }
    if (c === "'") {
      startWord();
      const end = s.indexOf("'", i + 1);
      if (end < 0) {
        word.text += s.slice(i + 1);
        word.dynamic = true;
        i = s.length;
      } else {
        word.text += s.slice(i + 1, end);
        i = end;
      }
      continue;
    }
    if (c === '"') {
      startWord();
      let j = i + 1;
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === "\\" && j + 1 < s.length && '"\\$`'.includes(s[j + 1])) {
          word.text += s[++j];
          continue;
        }
        if (s[j] === "$" || s[j] === "`") word.dynamic = true;
        word.text += s[j];
      }
      if (j >= s.length) word.dynamic = true;
      i = j;
      continue;
    }
    if (c === "$" || c === "`") {
      startWord();
      word.dynamic = true;
      word.text += c;
      continue;
    }
    if (c === "#" && !word) {
      const nl = s.indexOf("\n", i);
      i = nl < 0 ? s.length : nl - 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      endWord();
      continue;
    }
    if (c === "\n") {
      endWord();
      tokens.push({ op: "\n" });
      if (heredocs.length) i = skipHeredocs(i + 1) - 1;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === "&>") {
      endWord();
      let j = i + 2;
      if (s[j] === ">") j++;
      tokens.push({ redirect: s.slice(i, j) });
      i = j - 1;
      continue;
    }
    if (two === "&&" || two === "||" || two === "|&") {
      endWord();
      tokens.push({ op: two });
      i++;
      continue;
    }
    if (SEPARATORS.has(c)) {
      endWord();
      tokens.push({ op: c });
      continue;
    }
    if (c === ">" || c === "<") {
      if (word && !word.dynamic && /^[0-9]+$/.test(word.text)) word = null;
      else endWord();
      let j = i + 1;
      while (j < s.length && "<>&|".includes(s[j])) j++;
      if (s.slice(i, j) === "<<" && s[j] === "-") j++;
      const op = s.slice(i, j);
      tokens.push({ redirect: op });
      if (op === "<<" || op === "<<-") expectDelimiter = { strip: op === "<<-" };
      i = j - 1;
      continue;
    }
    startWord();
    word.text += c;
  }
  endWord();
  return tokens;
}

function expandTilde(text, home) {
  if (text === "~") return home || null;
  if (text.startsWith("~/")) return home ? join(home, text.slice(2)) : null;
  if (text.startsWith("~")) return null;
  return text;
}

function resolveWord(word, base, home) {
  if (!word || word.dynamic) return null;
  const text = expandTilde(word.text, home);
  if (text === null) return null;
  if (isAbsolute(text)) return resolve(text);
  return base === null ? null : resolve(base, text);
}

function stripPrefix(words) {
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (!w.dynamic && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w.text)) i++;
    else if (!w.dynamic && PREFIX_WORDS.has(w.text)) {
      i++;
      while (i < words.length && !words[i].dynamic && words[i].text.startsWith("-")) i++;
    } else break;
  }
  return words.slice(i);
}

function isGitWord(w) {
  return !w.dynamic && (w.text === "git" || /[\\/]git(\.exe)?$/.test(w.text));
}

function worktreeAddTarget(words, cwd, home) {
  let gitCwd = cwd;
  let pending = "";
  let i = 1;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w.dynamic && w.text.startsWith("-")) {
      pending ||= "a git option built from a variable";
      continue;
    }
    const t = w.text;
    if (t === "-C") {
      const next = resolveWord(words[++i], gitCwd, home);
      if (next === null) pending ||= "the -C directory";
      gitCwd = next;
    } else if (GIT_SCOPE_OPTIONS.has(t) || [...GIT_SCOPE_OPTIONS].some((o) => t.startsWith(o + "="))) {
      pending ||= "--git-dir or --work-tree";
      if (GIT_SCOPE_OPTIONS.has(t)) i++;
    } else if (GIT_VALUE_OPTIONS.has(t)) {
      i++;
    } else if (t.startsWith("-")) {
      continue;
    } else break;
  }
  if (words[i]?.text !== "worktree" || words[i]?.dynamic) return null;
  i++;
  if (words[i]?.dynamic) return { unresolved: "the worktree subcommand" };
  if (words[i]?.text !== "add") return null;
  if (pending) return { unresolved: pending };
  for (i++; i < words.length; i++) {
    const w = words[i];
    if (w.dynamic) return { unresolved: "the worktree path", gitCwd };
    const t = w.text;
    if (t === "--") {
      i++;
      break;
    }
    if (ADD_VALUE_OPTIONS.has(t)) i++;
    else if (!t.startsWith("-")) break;
  }
  const pathWord = words[i];
  if (!pathWord) return null;
  if (gitCwd === null) return { unresolved: "the working directory" };
  const target = resolveWord(pathWord, gitCwd, home);
  if (target === null) return { unresolved: "the worktree path", gitCwd };
  return { target, gitCwd };
}

export function parseCommands(command, { cwd, home }) {
  const out = [];
  const stack = [];
  let dir = typeof cwd === "string" && isAbsolute(cwd) ? cwd : null;
  let words = [];
  let redirects = [];
  const flush = () => {
    const cmd = stripPrefix(words);
    if (cmd.length || redirects.length) out.push({ words: cmd, dir, redirects });
    words = [];
    redirects = [];
    if (cmd.length && !cmd[0].dynamic && (cmd[0].text === "cd" || cmd[0].text === "pushd")) {
      const arg = cmd.slice(1).find((w) => w.dynamic || w.text === "-" || !w.text.startsWith("-"));
      if (arg && !arg.dynamic && arg.text === "-") dir = null;
      else dir = arg ? resolveWord(arg, dir, home) : home || null;
    }
  };
  const tokens = tokenize(command);
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.redirect) {
      const next = tokens[k + 1];
      if (next && next.text !== undefined) {
        redirects.push({ op: t.redirect, word: next });
        k++;
      }
      continue;
    }
    if (t.op) {
      flush();
      if (t.op === "(") stack.push(dir);
      else if (t.op === ")" && stack.length) dir = stack.pop();
      continue;
    }
    words.push(t);
  }
  flush();
  return out;
}

export function findWorktreeAdds(command, { cwd, home }) {
  const found = [];
  for (const seg of parseCommands(command, { cwd, home })) {
    if (!seg.words.length || !isGitWord(seg.words[0])) continue;
    const hit = worktreeAddTarget(seg.words, seg.dir, home);
    if (hit) found.push(hit);
  }
  return found;
}

const GIT_WRITE_SUBCOMMANDS = new Set(["add", "am", "apply", "checkout", "cherry-pick", "clean", "commit", "merge", "mv", "pull", "rebase", "reset", "restore", "revert", "rm", "stash", "switch"]);
const SED_VALUE_OPTIONS = new Set(["-e", "-f", "--expression", "--file", "-l", "--line-length"]);
const COPY_VALUE_OPTIONS = new Set(["-S", "--suffix", "-e", "--rsh", "-f", "--filter", "-T", "--temp-dir", "-B", "--block-size", "--exclude", "--include", "--exclude-from", "--include-from", "--files-from", "-m", "--mode", "-o", "--owner", "-g", "--group"]);

function commandName(w) {
  if (!w || w.dynamic) return "";
  const t = w.text.replace(/\\/g, "/");
  return t.slice(t.lastIndexOf("/") + 1).replace(/\.exe$/i, "");
}

function operands(words, valueOptions = new Set()) {
  const out = [];
  let endOfOptions = false;
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (!endOfOptions && !w.dynamic && w.text === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && !w.dynamic && w.text.startsWith("-") && w.text !== "-") {
      if (valueOptions.has(w.text)) i++;
      continue;
    }
    out.push(w);
  }
  return out;
}

function sedFiles(words) {
  let inPlace = false;
  let scriptGiven = false;
  const rest = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const t = w.text;
    if (!w.dynamic && (t === "-i" || t === "--in-place")) {
      inPlace = true;
      const next = words[i + 1];
      if (t === "-i" && next && !next.dynamic && (next.text === "" || next.text.startsWith("."))) i++;
      continue;
    }
    if (!w.dynamic && (/^-i./.test(t) || t.startsWith("--in-place=") || /^-[a-zA-Z]*i[a-zA-Z]*$/.test(t))) {
      inPlace = true;
      continue;
    }
    if (!w.dynamic && SED_VALUE_OPTIONS.has(t)) {
      scriptGiven = true;
      i++;
      continue;
    }
    if (!w.dynamic && (t.startsWith("--expression=") || t.startsWith("--file="))) {
      scriptGiven = true;
      continue;
    }
    if (!w.dynamic && t.startsWith("-") && t !== "-") continue;
    rest.push(w);
  }
  if (!inPlace) return [];
  return scriptGiven ? rest : rest.slice(1);
}

function copyDestination(words) {
  for (let i = 1; i < words.length; i++) {
    const t = words[i].text;
    if (words[i].dynamic) continue;
    if (t === "-t" || t === "--target-directory") return words[i + 1] ? [words[i + 1]] : [];
    if (t.startsWith("--target-directory=")) return [{ text: t.slice("--target-directory=".length), dynamic: false }];
  }
  const ops = operands(words, COPY_VALUE_OPTIONS);
  const dest = ops.length >= 2 ? ops[ops.length - 1] : null;
  if (!dest || (!dest.dynamic && /^[^/\\]+:/.test(dest.text) && !/^[A-Za-z]:[/\\]/.test(dest.text))) return [];
  return [dest];
}

function gitWriteDir(words, dir, home) {
  let gitCwd = dir;
  let i = 1;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w.dynamic) return null;
    if (w.text === "-C") gitCwd = resolveWord(words[++i], gitCwd, home);
    else if (GIT_SCOPE_OPTIONS.has(w.text) || GIT_VALUE_OPTIONS.has(w.text)) i++;
    else if (!w.text.startsWith("-")) break;
  }
  const sub = words[i];
  if (!sub || sub.dynamic || !GIT_WRITE_SUBCOMMANDS.has(sub.text)) return null;
  return gitCwd;
}

export function findWrites(command, { cwd, home }) {
  const found = [];
  const push = (word, base, how, isDir) => {
    if (!word.dynamic && (/^\/dev\//.test(word.text) || /^nul$/i.test(word.text))) return;
    const target = resolveWord(word, base, home);
    if (target === null || /^\/dev\//.test(target.replace(/\\/g, "/"))) return;
    found.push({ target, how, isDir });
  };
  for (const seg of parseCommands(command, { cwd, home })) {
    for (const r of seg.redirects) {
      if (!r.op.includes(">") || r.op === "<>") continue;
      if ((r.op.endsWith("&") || r.op === ">&") && !r.word.dynamic && /^([0-9]+|-)$/.test(r.word.text)) continue;
      push(r.word, seg.dir, "redirect", false);
    }
    const name = commandName(seg.words[0]);
    if (!name) continue;
    if (name === "tee") for (const w of operands(seg.words, new Set())) push(w, seg.dir, "tee", false);
    else if (name === "sed" || name === "gsed") for (const w of sedFiles(seg.words)) push(w, seg.dir, "sed -i", false);
    else if (["cp", "mv", "install", "ln", "rsync"].includes(name)) for (const w of copyDestination(seg.words)) push(w, seg.dir, name, true);
    else if (["touch", "rm", "rmdir", "truncate", "mkdir"].includes(name)) for (const w of operands(seg.words, new Set(["-s", "--size", "-m", "--mode", "-r", "--reference", "-t", "-d"]))) push(w, seg.dir, name, name === "mkdir" || name === "rmdir");
    else if (name === "dd") {
      for (const w of seg.words.slice(1)) if (!w.dynamic && w.text.startsWith("of=")) push({ text: w.text.slice(3), dynamic: false }, seg.dir, "dd", false);
    } else if (name === "git") {
      const gitCwd = gitWriteDir(seg.words, seg.dir, home);
      if (gitCwd) found.push({ target: gitCwd, how: "git", isDir: true });
    }
  }
  return found;
}

export function judgeWorktreeAdds(command, { cwd, home, git }) {
  for (const hit of findWorktreeAdds(command, { cwd, home })) {
    if (hit.unresolved) return { action: "cross", why: "worktree-unresolved", detail: hit.unresolved, target: hit.target || "" };
    const root = git.mainRoot(hit.gitCwd);
    if (!root) continue;
    const worktreesDir = join(root, WORKTREES_DIR);
    const target = resolveDir(hit.target);
    if (isUnder(target, worktreesDir) && target !== worktreesDir) {
      const host = (git.worktrees(root) || []).slice(1).find((wt) => isUnder(target, resolveDir(wt.path)));
      if (!host) continue;
      return { action: "cross", why: "worktree-nested", target: hit.target, root, worktreesDir, host: host.path };
    }
    return { action: "cross", why: "worktree-outside", target: hit.target, root, worktreesDir };
  }
  return { action: "pass", why: "no-stray-worktree" };
}