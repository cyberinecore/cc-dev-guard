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
  const startWord = () => {
    if (!word) word = { text: "", dynamic: false };
  };
  const endWord = () => {
    if (word) tokens.push(word);
    word = null;
  };
  const s = String(command);
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
    const two = s.slice(i, i + 2);
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
      endWord();
      let j = i + 1;
      while (s[j] === ">" || s[j] === "&" || s[j] === "|") j++;
      i = j - 1;
      tokens.push({ redirect: true });
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
  let i = 1;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w.dynamic && w.text.startsWith("-")) return { unresolved: "a git option built from a variable" };
    const t = w.text;
    if (t === "-C") {
      gitCwd = resolveWord(words[++i], gitCwd, home);
      if (gitCwd === null) return { unresolved: "the -C directory" };
    } else if (GIT_SCOPE_OPTIONS.has(t) || [...GIT_SCOPE_OPTIONS].some((o) => t.startsWith(o + "="))) {
      return { unresolved: "--git-dir or --work-tree" };
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

export function findWorktreeAdds(command, { cwd, home }) {
  const found = [];
  const stack = [];
  let dir = typeof cwd === "string" && isAbsolute(cwd) ? cwd : null;
  let words = [];
  const flush = () => {
    const cmd = stripPrefix(words);
    words = [];
    if (cmd.length === 0) return;
    if (!cmd[0].dynamic && (cmd[0].text === "cd" || cmd[0].text === "pushd")) {
      const arg = cmd.slice(1).find((w) => w.dynamic || w.text === "-" || !w.text.startsWith("-"));
      if (arg && !arg.dynamic && arg.text === "-") dir = null;
      else dir = arg ? resolveWord(arg, dir, home) : home || null;
      return;
    }
    if (isGitWord(cmd[0])) {
      const hit = worktreeAddTarget(cmd, dir, home);
      if (hit) found.push(hit);
    }
  };
  const tokens = tokenize(command);
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.redirect) {
      k++;
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