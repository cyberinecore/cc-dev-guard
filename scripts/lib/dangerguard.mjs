import { realPathOr } from "./paths.mjs";

export const DEFAULT_PROTECTED_BRANCHES = ["main", "master", "production", "prod", "development", "develop", "dev", "release", "staging"];
export const ESCAPE_ENV = "CY_ALLOW_DANGER";

const reAwsS3Delete = /\baws\s+(?:[-\w]+\s+)*?s3\s+(rm|rb)\b/i;
const reAwsS3ApiDel = /\baws\s+(?:[-\w]+\s+)*?s3api\s+delete-(bucket|object|objects)\b/i;
const reSQLDrop = /\bDROP\s+(DATABASE|SCHEMA|TABLE)/i;
const sqlIdent = String.raw`(?:"[^"]+"|\`[^\`]+\`|[A-Za-z_][\w.$]*)`;
const sqlIdentList = String.raw`${sqlIdent}(?:\s*,\s*${sqlIdent})*`;
const sqlTruncateOption = String.raw`\s+(?:cascade|restrict|restart|continue)\b`;
const reSQLTruncateTable = new RegExp(String.raw`\btruncate\s+table\s+(?:only\s+)?${sqlIdent}(?=[\s;'"\`)\\,/*]|--|$)`, "im");
const reSQLTruncateLead = new RegExp(String.raw`(?:^|[;'"\`(]|\*/)\s*truncate\s+(?:only\s+)?${sqlIdentList}(?:\s*(?:[;'"\`)\\*]|--|/\*|$)|${sqlTruncateOption})`, "im");
const reSQLTruncateEnd = new RegExp(String.raw`\btruncate\s+(?:only\s+)?${sqlIdentList}(?:\s*(?:[;\\*]|--|/\*|$)|${sqlTruncateOption})`, "im");
const reHeredoc = /(?<!<)<<(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2/g;
const reBareMktemp = /(["']?)\$\(mktemp(?:\s+[-\w./]+)*\s*\)\1(?=\s|$)/g;
const reTerraformDestroy = /\bterraform\s+(?:[-\w]+\s+)*?destroy\b/;
const reKubectlDelete = /\bkubectl\s+(?:[-\w]+\s+)*?delete\s+(?:[-\w]+\s+)*?(namespace|ns|pv|pvc|statefulsets?|sts|--all|-A)\b/;
const reDockerPrune = /\bdocker\s+(system\s+prune|volume\s+(rm|prune))\b/;
const reComposeDownV = /\bdocker\s+compose\b[^\n;&|]*\bdown\b[^\n;&|]*(\s-v\b|\s--volumes\b)/;
const reGitResetHard = /\bgit\s+(?:-C\s+\S+\s+)?reset\s+(?:[-\w]+\s+)*?--hard\b/;
const reGitDiscard = /\bgit\s+(?:-C\s+\S+\s+)?(checkout\s+--\s+\.|checkout\s+\.\s*$|restore\s+\.\s*$|restore\s+(?:--worktree\s+)?--\s+\.)/;
const reGitClean = /\bgit\s+(?:-C\s+\S+\s+)?clean\s+(?:[-\w]+\s+)*?-[a-zA-Z]*f/;
const reGitPush = /\bgit\s+(?:-C\s+\S+\s+)?push\b([^\n;&|]*)/g;
const reForceFlag = /(^|\s)(--force|-f|-[a-eg-zA-Z]*f[a-zA-Z]*)(\s|$)/;
const reMacTmpDir = /^(\/private)?\/var\/folders\/[^/]+\/[^/]+\/T\/[^/]/;
const reRm = /(^|\s|;|&&|\|\|)\s*(sudo\s+)?(?:\\|[^\s;&|]*\/)?rm\s+([^\n;&|]*)/g;
const reFind = /(^|\s|;|&&|\|\|)\s*(?:sudo\s+)?(?:[^\s;&|]*\/)?find\s+([^\n;&|]*)/g;
const reRmBin = /^(?:\\|[^\s;&|]*\/)?rm$/;
const reDropdb = /(^|\s|\/)dropdb(?:\s|$)/;
const reMysqladminDrop = /\bmysqladmin\s+(?:\S+\s+)*?drop\b/;
const reRedisFlush = /\bredis-cli\b[^\n;&|]*\bflush(?:all|db)\b/i;
const reBareFlush = /^\s*flush(?:all|db)(?:\s+(?:async|sync))?\s*$/i;
const reMongoShell = /(^|\s|\/)mongo(?:sh)?\s/;
const reMongoDestroy = /\.dropDatabase\s*\(|\.drop\s*\(|\.(?:deleteMany|remove)\s*\(\s*\{\s*\}\s*\)/;
const reBareMongo = /^\s*db(?:\.\w+|\[[^\]]+\])*\.(?:dropDatabase\s*\(|drop\s*\(|(?:deleteMany|remove)\s*\(\s*\{\s*\}\s*\))/;
const rePrismaReset = /\bprisma\s+(?:\S+\s+)*?(?:migrate\s+reset\b|db\s+push\b[^\n;&|]*\s--force-reset\b)/;
const reRailsDrop = /\b(?:rails|rake)\s+(?:\S+\s+)*?db:(?:drop|reset|schema:load)\b/;
const reArtisanFresh = /\bartisan\s+(?:\S+\s+)*?(?:migrate:fresh|db:wipe)\b/;
const reSequelizeDrop = /\bsequelize(?:-cli)?\s+(?:\S+\s+)*?db:drop\b/;
const reTypeormDrop = /\btypeorm\s+(?:\S+\s+)*?schema:drop\b/;
const reWranglerD1 = /\bwrangler\s+(?:\S+\s+)*?d1\s+delete\b/;
const reAwsRds = /\baws\s+(?:\S+\s+)*?rds\s+delete-db-(?:instance|cluster)\b/;
const reAwsDynamo = /\baws\s+(?:\S+\s+)*?dynamodb\s+delete-table\b/;
const reAzSqlDb = /\baz\s+(?:\S+\s+)*?sql\s+db\s+delete\b/;
const reAzCosmos = /\baz\s+(?:\S+\s+)*?cosmosdb\b[^\n;&|]*\sdelete\b/;
const reGcloudSql = /\bgcloud\s+(?:\S+\s+)*?sql\s+(?:instances|databases)\s+delete\b/;
const reDockerRm = /\bdocker\s+(?:-\S+\s+)*(?:container\s+|compose\s+(?:\S+\s+)*?)?rm\s+([^\n;&|]*)/;
const reVolumesFlag = /(^|\s)(--volumes|-[a-zA-Z]*v[a-zA-Z]*)(\s|$)/;
const reSQLDelete = /\bDELETE\s+FROM\s+(?:ONLY\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w.$]*)/gi;
const reDdDevice = /\bdd\b[^\n;&|]*\sof=["']?\/dev\/(?!(?:null|zero|full|random|urandom|stdout|stderr)\b|tty|fd\/)/;
const reMkfs = /(^|\s|\/)(?:mkfs(?:\.[\w-]+)?|wipefs)\s/;
const reGitBranch = /\bgit\s+(?:-C\s+\S+\s+)?branch\s+([^\n;&|]*)/;
const reBranchDeleteD = /(^|\s)-[a-zA-Z]*D[a-zA-Z]*(\s|$)/;
const reBranchDelete = /(^|\s)(--delete|-[a-zA-Z]*d[a-zA-Z]*)(\s|$)/;
const reGitStashClear = /\bgit\s+(?:-C\s+\S+\s+)?stash\s+clear\b/;

const reTagMention = /cachedir\.tag/i;
const TAG_WRITE_BINS = new Set(["cp", "mv", "ln", "install", "rsync", "ditto", "tar", "unzip", "dd", "tee", "touch", "curl", "wget", "scp"]);
const REGENERABLE_DIRS =new Set(["node_modules", "dist", "build", "out", ".next", ".nuxt", ".turbo", ".cache", "coverage", "target", ".build", "__pycache__", ".pytest_cache", ".mypy_cache", ".venv", "venv", ".parcel-cache", ".vite", ".svelte-kit", "tmp", ".tmp", "temp", ".DS_Store"]);
const TEXT_TOOLS = new Set(["echo", "printf", "grep", "rg", "egrep", "fgrep", "ugrep", "sed", "awk", "cat", "head", "tail", "less", "more", "wc", "sort", "uniq", "cut", "tr", "diff", "comm", "tee", "jq", "yq", "column", "fold", "nl", "od", "xxd"]);
const GIT_TEXT_SUBCOMMANDS = new Set(["log", "grep", "show", "diff", "blame"]);
const WRAPPER_BINS = new Set(["ssh", "bash", "sh", "zsh", "eval", "xargs", "sudo", "nohup", "timeout", "gtimeout", "caffeinate", "env", "script"]);
const QUOTED_ARG_BINS = new Set(["git", "gh", "glab", "jira", "linear", "curl", "cyberine"]);
const HEREDOC_SINK_BINS = new Set(["cat", "tee"]);

const fields = (s) => s.split(/\s+/).filter(Boolean);
const baseName = (p) => {
  const t = p.replace(/\/+$/, "");
  if (t === "") return p.startsWith("/") ? "/" : ".";
  return t.slice(t.lastIndexOf("/") + 1);
};
const isAssignment = (t) => t.includes("=") && !t.startsWith("=");

export function splitSubcommands(cmd) {
  return splitSegments(cmd).map((p) => p.text);
}

export function splitSegments(cmd) {
  const parts = [];
  let cur = "";
  let q = "";
  let op = "";
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      cur += c;
      if (c === "\\" && q === '"' && i + 1 < cmd.length) {
        cur += cmd[++i];
        continue;
      }
      if (c === q) q = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      q = c;
      cur += c;
      continue;
    }
    if (c === "|" || c === "&" || c === ";" || c === "\n") {
      if (cur.trim() !== "") {
        parts.push({ text: cur, op });
        op = "";
      }
      op += c;
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== "") parts.push({ text: cur, op });
  return parts;
}

export function shellWords(text, { lenient = false } = {}) {
  const words = [];
  let i = 0;
  const n = text.length;
  const fail = () => ({ words, ok: false });
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;
    const start = i;
    let value = "";
    while (i < n && !/\s/.test(text[i])) {
      const c = text[i];
      if (c === "'") {
        const end = text.indexOf("'", i + 1);
        if (end < 0) {
          if (!lenient) return fail();
          value += text.slice(i + 1);
          i = n;
          break;
        }
        value += text.slice(i + 1, end);
        i = end + 1;
      } else if (c === '"') {
        let j = i + 1;
        let closed = false;
        while (j < n) {
          if (text[j] === "\\" && j + 1 < n && '$`"\\\n'.includes(text[j + 1])) {
            value += text[j + 1];
            j += 2;
            continue;
          }
          if (text[j] === '"') {
            closed = true;
            break;
          }
          value += text[j++];
        }
        if (!closed && !lenient) return fail();
        i = closed ? j + 1 : n;
      } else if (c === "\\") {
        if (i + 1 < n) value += text[i + 1];
        i += 2;
      } else if (c === "$" && text[i + 1] === "(") {
        let depth = 0;
        let j = i + 1;
        for (; j < n; j++) {
          if (text[j] === "(") depth++;
          else if (text[j] === ")" && --depth === 0) break;
        }
        if (j >= n && !lenient) return fail();
        value += text.slice(i, j + 1);
        i = j + 1;
      } else if (c === "`") {
        const end = text.indexOf("`", i + 1);
        if (end < 0 && !lenient) return fail();
        value += text.slice(i, end < 0 ? n : end + 1);
        i = end < 0 ? n : end + 1;
      } else {
        value += c;
        i++;
      }
    }
    words.push({ raw: text.slice(start, i), value });
  }
  return { words, ok: true };
}

const reAssignWord = /^([A-Za-z_]\w*)=/;

function opKind(op) {
  const s = op.replace(/\n/g, ";");
  if (/^;*$/.test(s)) return "seq";
  if (/^&&;*$/.test(s)) return "and";
  return "other";
}

const reMktempValue = /^(["']?)\$\(mktemp(?:\s+[^\s()`;|&<>]+)*\s*\)\1$/;
export const MKTEMP_VALUE = "$TMPDIR/mktemp-made";

function literalValue(raw, value, home) {
  if (reMktempValue.test(raw)) return MKTEMP_VALUE;
  if (/`|\$\(/.test(raw)) return null;
  let v = value;
  const homeRef = /^\$(?:HOME(?!\w)|\{HOME\})/.exec(v);
  if (homeRef && /^"?\$/.test(raw)) {
    if (!home) return null;
    v = home + v.slice(homeRef[0].length);
  } else if (/^~(?:\/|$)/.test(raw)) {
    if (!home) return null;
    v = home + v.slice(1);
  }
  return v.includes("$") ? null : v;
}

function literalAssignments(text, home) {
  const { words, ok } = shellWords(text);
  if (!ok || !words.length) return null;
  const list = words[0].value === "export" && words[0].raw === "export" ? words.slice(1) : words;
  if (!list.length || !list.every((w) => reAssignWord.test(w.raw))) return null;
  return list.map((w) => {
    const name = reAssignWord.exec(w.raw)[1];
    return [name, literalValue(w.raw.slice(name.length + 1), w.value.slice(name.length + 1), home)];
  });
}

function mentionsName(text, name) {
  return new RegExp(String.raw`(?:^|[^\w\${])${name}(?!\w)`).test(text);
}

export function assignedVars(segments, home) {
  const env = new Map();
  const out = [];
  for (const { text, op } of segments) {
    const kind = opKind(op);
    for (const v of env.values()) if (kind === "other" || (kind === "seq" && v.cond)) v.value = null;
    out.push(new Map([...env].map(([k, v]) => [k, v.value])));
    const assigned = literalAssignments(text, home);
    if (assigned) {
      for (const [name, value] of assigned) env.set(name, { value: env.has(name) || kind === "other" ? null : value, cond: kind === "and" });
    } else {
      for (const [name, v] of env) if (mentionsName(text, name)) v.value = null;
    }
  }
  return out;
}

function resolveVar(value, vars) {
  const m = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))(?=\/|$)/.exec(value);
  if (!m || !vars) return value;
  const v = vars.get(m[1] || m[2]);
  return typeof v === "string" ? v + value.slice(m[0].length) : value;
}

export function normalizeTarget(t) {
  let root = "";
  let rest = t;
  if (t.startsWith("/")) {
    root = "/";
    rest = t.slice(1);
  } else if (/^[~$]/.test(t)) {
    const i = t.indexOf("/");
    root = i < 0 ? t : t.slice(0, i);
    rest = i < 0 ? "" : t.slice(i + 1);
  }
  const out = [];
  for (const seg of rest.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg !== "..") {
      out.push(seg);
      continue;
    }
    if (out.length) out.pop();
    else if (root !== "/") return { path: t, climbs: true };
  }
  if (root === "/") return { path: "/" + out.join("/"), climbs: false };
  if (root) return { path: out.length ? `${root}/${out.join("/")}` : root, climbs: false };
  return { path: out.join("/") || ".", climbs: false };
}

export function isTextOnly(sub) {
  let toks = fields(sub);
  while (toks.length && (isAssignment(toks[0]) || toks[0] === "sudo" || toks[0] === "env" || toks[0] === "time")) toks = toks.slice(1);
  if (!toks.length) return true;
  const bin = baseName(toks[0]);
  if (TEXT_TOOLS.has(bin)) return true;
  if (bin === "git") {
    for (const t of toks.slice(1)) {
      if (t.startsWith("-")) continue;
      return GIT_TEXT_SUBCOMMANDS.has(t);
    }
  }
  return false;
}

function firstBin(sub) {
  let toks = fields(sub);
  while (toks.length && isAssignment(toks[0])) toks = toks.slice(1);
  if (!toks.length) return ["", []];
  return [baseName(toks[0]), toks];
}

function isWrapper(sub) {
  const [bin, toks] = firstBin(sub);
  if (!bin) return false;
  if (WRAPPER_BINS.has(bin) || bin.endsWith(".sh")) return true;
  if ((bin === "docker" || bin === "kubectl") && toks.length > 1) {
    for (const t of toks.slice(1)) {
      if (t.startsWith("-")) continue;
      return t === "exec";
    }
  }
  return false;
}

export function quotedStrings(sub) {
  const out = [];
  let cur = "";
  let q = "";
  for (let i = 0; i < sub.length; i++) {
    const c = sub[i];
    if (q) {
      if (c === "\\" && q === '"' && i + 1 < sub.length) {
        cur += sub[++i];
        continue;
      }
      if (c === q) {
        out.push(cur);
        cur = "";
        q = "";
        continue;
      }
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') q = c;
  }
  return out;
}

function stripQuotedArgs(sub) {
  let b = "";
  let q = "";
  for (let i = 0; i < sub.length; i++) {
    const c = sub[i];
    if (q) {
      if (c === "\\" && q === '"' && i + 1 < sub.length) {
        i++;
        continue;
      }
      if (c === q) q = "";
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      continue;
    }
    b += c;
  }
  return b;
}

export function unquotedAt(line, index) {
  const stack = [];
  for (let i = 0; i < index; i++) {
    const c = line[i];
    const top = stack[stack.length - 1];
    if (top === "'") {
      if (c === "'") stack.pop();
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "$" && line[i + 1] === "(") {
      stack.push("(");
      i++;
      continue;
    }
    if (top === "(" && c === ")") {
      stack.pop();
      continue;
    }
    if (top === '"') {
      if (c === '"') stack.pop();
      continue;
    }
    if (c === "'" || c === '"') stack.push(c);
  }
  return !stack.includes("'") && stack[stack.length - 1] !== '"';
}

function heredocSinkOnly(line, m) {
  const before = line.slice(0, m.index);
  const after = line.slice(m.index + m[0].length);
  if (!unquotedAt(line, m.index)) return false;
  if (/[<>]\(/.test(line) || /\\\s*$/.test(line) || /\|/.test(after)) return false;
  if ([...line.matchAll(reHeredoc)].length !== 1) return false;
  const sub = before.lastIndexOf("$(");
  const cut = Math.max(sub, before.lastIndexOf("|"), before.lastIndexOf(";"), before.lastIndexOf("&"));
  if (!HEREDOC_SINK_BINS.has(leadingBin(before.slice(cut + 1).replace(/^\(/, "")))) return false;
  if (cut !== sub || sub < 0) return true;
  const outer = before.slice(0, sub);
  const outerCut = Math.max(outer.lastIndexOf("$("), outer.lastIndexOf("|"), outer.lastIndexOf(";"), outer.lastIndexOf("&"));
  return outerCut < 0 && leadingBin(outer) === "git";
}

function leadingBin(text) {
  let toks = fields(text);
  while (toks.length && (isAssignment(toks[0]) || toks[0] === "sudo")) toks = toks.slice(1);
  return toks.length ? baseName(toks[0]) : "";
}

export function stripTextHeredocs(cmd) {
  const lines = cmd.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const docs = [...line.matchAll(reHeredoc)];
    if (docs.length !== 1 || !heredocSinkOnly(line, docs[0])) continue;
    const m = docs[0];
    const delimiter = m[3];
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if ((m[1] === "-" ? lines[j].replace(/^\t+/, "") : lines[j]) === delimiter) {
        end = j;
        break;
      }
    }
    if (end < 0) continue;
    const body = lines.slice(i + 1, end);
    if (!m[2] && body.some((l) => l.includes("$(") || l.includes("`"))) continue;
    out.push(lines[end]);
    i = end;
  }
  return out.join("\n");
}

export function stripCommentLines(cmd) {
  return cmd
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
}

export function dangerReason(command, { home = "", configDir = "", protectedBranches = DEFAULT_PROTECTED_BRANCHES, awsS3 = true, isCacheDir = null, isRepoRoot = null, root = "", cwd = "" } = {}) {
  if (typeof command !== "string" || command === "") return "";
  const opts = { home: home.replace(/\/+$/, ""), configDir, protectedBranches: new Set(protectedBranches), awsS3, isCacheDir, isRepoRoot, root, cwd };
  return tagWriteShapeReason(command) || guardDepth(command, 0, opts);
}

export function dangerAskReason(command, { home = "", configDir = "", protectedBranches = DEFAULT_PROTECTED_BRANCHES, isCacheDir = null, isRepoRoot = null, root = "", cwd = "", git = null } = {}) {
  if (typeof command !== "string" || command === "") return "";
  const opts = { home: home.replace(/\/+$/, ""), configDir, protectedBranches: new Set(protectedBranches), isCacheDir, isRepoRoot, root, cwd, git };
  return guardDepth(command, 0, opts, subcommandAsk);
}

const WORKTREE_ROUTES = "Leave a session's own worktree with ExitWorktree, remove a background session's worktree with `claude rm <id>`, or run plain `git worktree remove <path>` without --force, which refuses a worktree that holds uncommitted work.";
const GIT_PREFIX_BINS = new Set(["sudo", "env", "command", "nohup", "time", "exec"]);
const reWorktreeRoot = /(^|\/)\.claude\/worktrees(\/[^/]+)?\/?$/;

function subcommandAsk(scan, opts, sub) {
  return gitAsk(sub, opts) || rmWorktreeAsk(scan, opts);
}

const slashed = (p) => String(p || "").replace(/\\/g, "/");
const isAbsPath = (p) => /^(?:\/|[A-Za-z]:\/)/.test(slashed(p));

function resolvePath(base, p) {
  const s = slashed(p);
  if (/^[A-Za-z]:\//.test(s)) return joinPosix(s.slice(0, 2), s.slice(3));
  if (s.startsWith("/")) return joinPosix("/", s);
  return joinPosix(slashed(base), s);
}

function pathKey(p) {
  const s = slashed(realPathOr(p)).replace(/\/+$/, "").replace(/^[a-z]:/, (d) => d.toUpperCase());
  return process.platform === "win32" ? s.toLowerCase() : s;
}

function segmentCwds(segments, cwd, home) {
  const out = [];
  let cur = isAbsPath(cwd) ? resolvePath("/", cwd) : "";
  for (const { text } of segments) {
    out.push(cur);
    const { words, ok } = shellWords(text);
    const bin = (words[0]?.value || "").replace(/^[({]+/, "");
    if (bin !== "cd" && bin !== "pushd" && bin !== "popd") continue;
    const arg = words.slice(1).find((w) => !w.value.startsWith("-") || w.value === "-")?.value;
    const target = arg === undefined ? home || "" : /^~(?:\/|$)/.test(arg) ? (home ? home + arg.slice(1) : "") : arg;
    if (!ok || bin === "popd" || !target || target === "-" || /[$`*?]/.test(target) || (!isAbsPath(target) && !cur)) cur = "";
    else cur = resolvePath(cur, target);
  }
  return out;
}

function gitInvocation(sub) {
  const { words, ok } = shellWords(sub);
  if (!ok) return { unparsed: true };
  let i = 0;
  while (i < words.length && (reAssignWord.test(words[i].raw) || GIT_PREFIX_BINS.has(words[i].value))) i++;
  if (!words[i] || baseName(words[i].value) !== "git") return null;
  const g = { dirs: [], gitDir: false, sub: "", args: [] };
  for (i++; i < words.length; i++) {
    const v = words[i].value;
    if (v === "-C") g.dirs.push(words[++i]?.value ?? "");
    else if (v === "-c" || v === "--namespace") i++;
    else if (v === "--git-dir" || v === "--work-tree") {
      g.gitDir = true;
      i++;
    } else if (/^--(?:git-dir|work-tree)=/.test(v)) g.gitDir = true;
    else if (!v.startsWith("-")) break;
  }
  g.sub = words[i]?.value ?? "";
  g.args = words.slice(i + 1).map((w) => w.value);
  return g;
}

function gitAsk(sub, opts) {
  const g = gitInvocation(sub);
  if (!g) return "";
  if (g.unparsed) {
    if (/\bgit\b/.test(sub) && /\bworktree\s+remove\b|\bbranch\s+(?:\S+\s+)*?-[a-zA-Z]*[dD]/.test(sub)) return "this `git worktree remove` or `git branch` delete could not be parsed (unbalanced quoting), so the guard cannot tell what it deletes. Approve only if you expected it.";
    return "";
  }
  if (g.sub === "worktree" && g.args[0] === "remove") return worktreeRemoveAsk(g, opts);
  if (g.sub === "branch") return branchDeleteAsk(g, opts);
  return "";
}

function gitBase(g, { cwd, home }) {
  if (!isAbsPath(cwd)) return "";
  let dir = resolvePath("/", cwd);
  for (const d of g.dirs) {
    if (!d || /[$`]/.test(d)) return "";
    dir = resolvePath(dir, /^~(?:\/|$)/.test(d) && home ? home + d.slice(1) : d);
  }
  return dir;
}

const probeFailed = (what, why) => `${what}: the guard could not check what it would delete (${why}), so it cannot tell whether work would be lost. Approve only if you expected it.`;

function listed(items, max = 5) {
  const shown = items.slice(0, max).map((x) => `\`${x}\``).join(", ");
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}

function worktreeRemoveAsk(g, opts) {
  const rest = g.args.slice(1);
  const paths = rest.filter((a) => !a.startsWith("-"));
  if (rest.some((a) => a === "--force" || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a))) return `\`git worktree remove --force ${paths.join(" ")}\` deletes the worktree even when it holds uncommitted changes or untracked files, which are then lost. ${WORKTREE_ROUTES}`;
  if (opts.nested) return "";
  for (const p of paths) {
    const r = worktreeLoss(p, g, opts);
    if (r) return r;
  }
  return "";
}

function worktreeLoss(p, g, { git, home, cwd }) {
  const what = `\`git worktree remove ${p}\``;
  if (g.gitDir) return probeFailed(what, "it names --git-dir or --work-tree");
  const base = gitBase(g, { cwd, home });
  if (!base) return probeFailed(what, "the directory git runs in cannot be resolved");
  if (/[$`*?]/.test(p)) return probeFailed(what, "the path is built from a variable, substitution or glob");
  if (!git) return probeFailed(what, "git is not available to the guard");
  const list = git.worktrees(base);
  if (!list) return probeFailed(what, "`git worktree list` failed");
  const want = pathKey(resolvePath(base, /^~(?:\/|$)/.test(p) && home ? home + p.slice(1) : p));
  let entry = list.find((e) => pathKey(e.path) === want);
  if (!entry && !isAbsPath(p)) {
    const tail = "/" + slashed(p).replace(/\/+$/, "");
    const named = list.filter((e) => slashed(e.path).endsWith(tail));
    if (named.length === 1) entry = named[0];
  }
  if (!entry || entry === list[0] || entry.bare || entry.prunable !== null) return "";
  const lost = [];
  const ignored = git.ignoredPaths(entry.path);
  if (!ignored) return probeFailed(what, "`git ls-files --ignored` failed");
  const regenerable = (x) => x.split("/").some((seg) => REGENERABLE_DIRS.has(seg)) || /\.tsbuildinfo$/.test(x);
  const kept = [];
  for (const x of ignored) {
    if (regenerable(x)) continue;
    if (!x.endsWith("/")) {
      kept.push(x);
      continue;
    }
    const inner = git.ignoredPaths(entry.path, x);
    if (!inner) return probeFailed(what, "`git ls-files --ignored` failed");
    const left = [...new Set(inner.filter((y) => !regenerable(y)).map((y) => {
      const segs = y.slice(x.length).split("/");
      return segs.length > 1 ? `${x}${segs[0]}/` : y;
    }))];
    kept.push(...left);
  }
  if (kept.length) lost.push(`ignored files that no commit holds (${listed(kept)})`);
  if (entry.detached && entry.head) {
    const n = git.countRevs(base, [entry.head, "--not", "--branches", "--tags", "--remotes"]);
    if (n === null) return probeFailed(what, "`git rev-list` failed");
    if (n > 0) lost.push(`${n} commit${n === 1 ? "" : "s"} reachable only from its detached HEAD \`${entry.head.slice(0, 12)}\``);
  }
  if (!lost.length) return "";
  return `${what} deletes ${lost.join(" and ")}. Move those files out or delete them once the user says they may go (a copy is not enough: the check looks at what is still in the worktree; regenerable folders such as tmp/, dist/ and node_modules/ do not count), and \`git -C ${entry.path} branch <name>\` keeps the commits; or approve only if they may go.`;
}

function branchDeleteAsk(g, opts) {
  const args = g.args.join(" ");
  if (!reBranchDeleteD.test(args) && !(reBranchDelete.test(args) && reForceFlag.test(args))) return "";
  if (opts.nested) return "";
  const names = g.args.filter((a) => !a.startsWith("-") && !opts.protectedBranches.has(a));
  for (const b of names) {
    const what = `\`git branch -D ${b}\``;
    if (g.gitDir) return probeFailed(what, "it names --git-dir or --work-tree");
    const base = gitBase(g, opts);
    if (!base) return probeFailed(what, "the directory git runs in cannot be resolved");
    if (!/^[\w][\w./@+-]*$/.test(b)) return probeFailed(what, "the branch name is built from a variable, substitution or unusual characters");
    if (!opts.git) return probeFailed(what, "git is not available to the guard");
    const exists = opts.git.refExists(base, `refs/heads/${b}`);
    if (exists === null) return probeFailed(what, "`git rev-parse` failed");
    if (!exists) continue;
    const n = opts.git.countRevs(base, [`refs/heads/${b}`, "--not", "--remotes"]);
    if (n === null) return probeFailed(what, "`git rev-list` failed");
    if (n > 0) return `${what} deletes ${n} commit${n === 1 ? "" : "s"} that no remote has. Push the branch first (\`git push -u origin ${b}\`), or approve only if they may go.`;
  }
  return "";
}

function rmWorktreeAsk(scan, opts) {
  for (const call of rmCalls(scan)) {
    if (!call.recursive || !call.ok) continue;
    for (const w of call.targets) {
      const target = rmTarget(w.raw, w.value, opts.vars);
      if (target.climbs) continue;
      const path = slashed(target.path);
      const abs = /^[/~$]/.test(path) || isAbsPath(path) || !isAbsPath(opts.cwd) ? "" : resolvePath(opts.cwd, path);
      if (reWorktreeRoot.test(path) || reWorktreeRoot.test(abs)) return `recursive rm of \`${target.shown}\` deletes a git worktree under .claude/worktrees/ with any uncommitted work, ignored files and commits no branch holds, and leaves a stale worktree record behind. ${WORKTREE_ROUTES}`;
    }
  }
  return "";
}

export const TAG_WRITE_REASON = "writing a CACHEDIR.TAG file is denied: danger_guard lets a recursive rm through for a directory that carries one, so only the tool that owns the cache may create it.";

export function isCacheDirTagPath(path) {
  return typeof path === "string" && baseName(path.replace(/\\/g, "/")).toUpperCase() === "CACHEDIR.TAG";
}

function tagWriteShapeReason(cmd) {
  for (const sub of splitSubcommands(stripCommentLines(stripTextHeredocs(cmd)))) {
    if (!reTagMention.test(sub)) continue;
    const [bin] = firstBin(sub);
    if (tagRedirect(sub) || TAG_WRITE_BINS.has(bin)) return TAG_WRITE_REASON;
  }
  return "";
}

function tagRedirect(sub) {
  for (let i = sub.indexOf(">"); i >= 0; i = sub.indexOf(">", i + 1)) {
    if (!unquotedAt(sub, i)) continue;
    let j = i + 1;
    if (sub[j] === ">" || sub[j] === "|") j++;
    if (sub[j] === "&") continue;
    const m = /^\s*("[^"]*"|'[^']*'|[^\s;&|<>]+)/.exec(sub.slice(j));
    const target = m ? m[1].replace(/^["']|["']$/g, "") : "";
    if (target === "/dev/null" || target === "/dev/stderr" || target === "/dev/stdout") continue;
    if (target === "") continue;
    if (reTagMention.test(target) || target.includes("$") || target.includes("`")) return true;
  }
  return false;
}

const HEREDOC_NOTE = " The match is in a heredoc body fed to an interpreter; if that text is data written into a file, write the file with a plain cat heredoc first.";
const QUOTED_NOTE = (bin) => ` The match is inside a quoted string handed to \`${bin}\`, which runs it as a command.`;

function guardDepth(cmd, depth, opts, check = subcommandReason) {
  if (depth > 3) return "";
  const stripped = stripCommentLines(stripTextHeredocs(cmd));
  const bodies = depth === 0 ? heredocBodyLines(stripped) : [];
  const inBody = (text) => bodies.some((l) => l.includes(text.trim()));
  const scans = [];
  const segments = splitSegments(stripped);
  const vars = assignedVars(segments, opts.home);
  const cwds = check === subcommandReason ? null : segmentCwds(segments, opts.cwd, opts.home);
  for (let k = 0; k < segments.length; k++) {
    const sub = segments[k].text;
    if (isTextOnly(sub)) continue;
    const [bin] = firstBin(sub);
    const scan = QUOTED_ARG_BINS.has(bin) ? stripQuotedArgs(sub) : sub;
    scans.push(scan);
    const r = check(scan, cwds ? { ...opts, vars: vars[k], cwd: cwds[k] } : { ...opts, vars: vars[k] }, sub);
    if (r) return inBody(sub) ? r + HEREDOC_NOTE : r;
    if (isWrapper(sub)) {
      for (const inner of quotedStrings(sub)) {
        const ri = guardDepth(inner, depth + 1, { ...opts, nested: true }, check);
        if (ri) return depth === 0 ? ri + QUOTED_NOTE(bin) : ri;
      }
    }
  }
  if (check !== subcommandReason) return "";
  const sql = sqlDeleteReason(scans.join("\n"));
  const reDeleteOnce = new RegExp(reSQLDelete.source, "i");
  return sql && bodies.some((l) => reDeleteOnce.test(l)) ? sql + HEREDOC_NOTE : sql;
}

function heredocBodyLines(cmd) {
  const lines = cmd.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = [...lines[i].matchAll(reHeredoc)][0];
    if (!m) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if ((m[1] === "-" ? lines[j].replace(/^\t+/, "") : lines[j]) === m[3]) {
        i = j;
        break;
      }
      out.push(lines[j]);
    }
  }
  return out;
}

function subcommandReason(s, opts) {
  if (opts.awsS3 && (reAwsS3Delete.test(s) || reAwsS3ApiDel.test(s))) return "`aws s3 rm/rb` and `aws s3api delete-*` are denied (they delete buckets or objects).";
  if (reSQLDrop.test(s) || reSQLTruncateTable.test(s) || reSQLTruncateLead.test(s) || reSQLTruncateEnd.test(s)) return "DROP DATABASE/SCHEMA/TABLE and TRUNCATE are denied.";
  if (reTerraformDestroy.test(s)) return "`terraform destroy` is denied.";
  if (reKubectlDelete.test(s)) return "`kubectl delete` of a namespace, pv/pvc, statefulset, or --all is denied.";
  if (reDockerPrune.test(s) || reComposeDownV.test(s)) return "`docker system prune`, `docker volume rm/prune` and `docker compose down -v` are denied (they delete volumes).";
  if (reGitResetHard.test(s) || reGitDiscard.test(s) || reGitClean.test(s)) return "`git reset --hard`, `git checkout -- .`, `git restore .` and `git clean -f` discard uncommitted work; denied.";
  if (reGitStashClear.test(s)) return "`git stash clear` drops every stash entry; denied.";
  if (reDropdb.test(s) || reMysqladminDrop.test(s)) return "`dropdb` and `mysqladmin drop` are denied (they delete a database).";
  if (reRedisFlush.test(s) || reBareFlush.test(s)) return "`redis-cli FLUSHALL`/`FLUSHDB` is denied (it deletes every key).";
  if ((reMongoShell.test(s) && reMongoDestroy.test(s)) || reBareMongo.test(s)) return "`dropDatabase()`, `.drop()`, `deleteMany({})` and `remove({})` in a mongo shell are denied (they delete a database or collection).";
  if (rePrismaReset.test(s) || reRailsDrop.test(s) || reArtisanFresh.test(s) || reSequelizeDrop.test(s) || reTypeormDrop.test(s)) return "database resets through an ORM CLI (`prisma migrate reset`, `prisma db push --force-reset`, `rails db:drop`/`db:reset`/`db:schema:load`, `rake db:drop`, `artisan migrate:fresh`/`db:wipe`, `sequelize db:drop`, `typeorm schema:drop`) are denied.";
  if (reWranglerD1.test(s) || reAwsRds.test(s) || reAwsDynamo.test(s) || reAzSqlDb.test(s) || reAzCosmos.test(s) || reGcloudSql.test(s)) return "deleting a managed database (`wrangler d1 delete`, `aws rds delete-db-instance`/`delete-db-cluster`, `aws dynamodb delete-table`, `az sql db delete`, `az cosmosdb ... delete`, `gcloud sql instances/databases delete`) is denied.";
  if (reDdDevice.test(s) || reMkfs.test(s)) return "`dd of=/dev/<device>`, `mkfs` and `wipefs` are denied (they overwrite a block device).";
  return dockerRmReason(s) || gitBranchReason(s, opts) || gitPushReason(s, opts) || findReason(s, opts) || rmReason(s, opts) || "";
}

function sqlDeleteReason(cmd) {
  for (const m of cmd.matchAll(reSQLDelete)) {
    const end = cmd.indexOf(";", m.index);
    const statement = cmd.slice(m.index, end < 0 ? cmd.length : end);
    if (!/\bWHERE\b/i.test(statement)) return "`DELETE FROM` without a `WHERE` clause is denied (it empties the table).";
  }
  return "";
}

function dockerRmReason(cmd) {
  const m = reDockerRm.exec(cmd);
  if (m && reVolumesFlag.test(m[1])) return "`docker rm -v`/`--volumes` is denied (it deletes the container's volumes).";
  return "";
}

function gitBranchReason(cmd, { protectedBranches }) {
  const m = reGitBranch.exec(cmd);
  if (!m) return "";
  const args = m[1];
  if (!reBranchDeleteD.test(args) && !(reBranchDelete.test(args) && reForceFlag.test(args))) return "";
  for (const t of fields(m[1])) {
    if (!t.startsWith("-") && protectedBranches.has(t)) return `\`git branch -D\` of protected branch \`${t}\` is denied.`;
  }
  return "";
}

function findReason(cmd, opts) {
  for (const m of cmd.matchAll(reFind)) {
    const toks = fields(m[2]);
    const roots = [];
    let i = 0;
    for (; i < toks.length; i++) {
      const t = toks[i];
      if (t === "-H" || t === "-L" || t === "-P" || /^-O\d*$/.test(t)) continue;
      if (t === "-D") {
        i++;
        continue;
      }
      if (t.startsWith("-") || t === "!" || t === "(" || t === "\\(") break;
      roots.push(t);
    }
    if (!roots.length) roots.push(".");
    let destructive = "";
    for (; i < toks.length; i++) {
      if (toks[i] === "-delete") destructive = "-delete";
      if ((toks[i] === "-exec" || toks[i] === "-execdir") && recursiveRmAt(toks, i + 1)) destructive = toks[i] + " rm -r";
    }
    if (!destructive) continue;
    for (const root of roots) {
      const norm = normalizeTarget(root);
      if (!norm.climbs && norm.path === ".") continue;
      const r = rmTargetReason(root, opts);
      if (r) return `\`find ${root} ... ${destructive}\` is denied (${r.replace(/\.$/, "")}).`;
    }
  }
  return "";
}

function recursiveRmAt(toks, i) {
  if (toks[i] === "sudo") i++;
  if (!reRmBin.test(toks[i] || "")) return false;
  for (let j = i + 1; j < toks.length; j++) {
    const t = toks[j];
    if (t === "{}" || t === ";" || t === "\\;" || t === "+") break;
    if (t === "--recursive" || (/^-[a-zA-Z]+$/.test(t) && /[rR]/.test(t))) return true;
  }
  return false;
}

function gitPushReason(cmd, { protectedBranches }) {
  for (const m of cmd.matchAll(reGitPush)) {
    const args = m[1];
    const forced = reForceFlag.test(args) || args.includes(" +");
    if (!forced) continue;
    if (args.includes("--force-with-lease") && !args.includes("--force ") && !reForceFlag.test(args.replaceAll("--force-with-lease", ""))) continue;
    let named = false;
    for (const tok of fields(args)) {
      let t = tok.startsWith("+") ? tok.slice(1) : tok;
      const i = t.lastIndexOf(":");
      if (i >= 0) t = t.slice(i + 1);
      if (t.startsWith("refs/heads/")) t = t.slice("refs/heads/".length);
      if (protectedBranches.has(t)) return `force-push to protected branch \`${t}\` is denied.`;
      if (!tok.startsWith("-")) named = true;
    }
    if (!named) return "force-push with no explicit branch is denied (the current branch may be protected); name the branch.";
  }
  return "";
}

const reRecursiveFlag = /(^|\s)(--recursive|-[a-zA-Z]*[rR][a-zA-Z]*)(\s|$)/;

function rmCalls(cmd) {
  const calls = [];
  for (const m of cmd.matchAll(reRm)) {
    const start = m.index + m[0].length - m[3].length;
    const quoted = !unquotedAt(cmd, start);
    const args = (quoted ? m[3] : cmd.slice(start)).replace(reBareMktemp, " ");
    const parsed = shellWords(args, { lenient: quoted });
    let recursive = false;
    const targets = [];
    for (const w of parsed.words) {
      const t = w.value;
      if (t === "--") continue;
      if (t.startsWith("--")) {
        if (t === "--recursive") recursive = true;
        continue;
      }
      if (t.startsWith("-") && t.length > 1) {
        if (/[rR]/.test(t.slice(1))) recursive = true;
        continue;
      }
      targets.push(w);
    }
    if (!parsed.ok) recursive = recursive || reRecursiveFlag.test(args);
    calls.push({ index: m.index, recursive, targets, ok: parsed.ok, args });
  }
  return calls;
}

function rmReason(cmd, opts) {
  for (const call of rmCalls(cmd)) {
    if (!call.recursive) continue;
    if (leadingBin(cmd.slice(0, call.index)) === "xargs") return "recursive rm through `xargs` is denied: the targets come from stdin and cannot be resolved; write the literal paths.";
    if (!call.ok) return `recursive rm of \`${call.args.trim()}\` is denied: the guard cannot parse its quoting, so it cannot tell which paths are removed; write each path plainly quoted.`;
    for (const w of call.targets) {
      const r = rmTargetReason(w.raw, opts, w.value);
      if (r) return r;
    }
  }
  return "";
}

const VAR_OK = ["$CLAUDE_JOB_DIR", "$TMPDIR", "${CLAUDE_JOB_DIR", "${TMPDIR"];
const reLexicalDots = /(^|\/)\.\.?(\/|$)/;

function rmTarget(raw, value, vars) {
  const resolved = resolveVar(value, vars);
  const shown = resolved !== value ? `${raw} (= ${resolved})` : raw;
  return { shown, lexical: resolved, ...normalizeTarget(resolved) };
}

function rmTargetReason(raw, opts, value = raw.replace(/^["']+|["']+$/g, "")) {
  const { home, configDir, isCacheDir, isRepoRoot, root = "", cwd = "", vars } = opts;
  if (value === "") return "";
  const target = rmTarget(raw, value, vars);
  const quotedRaw = raw;
  raw = target.shown;
  if (target.lexical === "") return "";
  if (target.lexical.startsWith("$") && !VAR_OK.some((p) => target.lexical.startsWith(p))) return `recursive rm of \`${raw}\` is denied: the target is a shell variable the guard cannot resolve; write the literal path.`;
  if (target.climbs) return `recursive rm of \`${raw}\` is denied: it climbs above the directory it starts from.`;
  const t = target.path;
  if (isHomeCache(t, home) && !reLexicalDots.test(target.lexical)) return "";
  if (t === "*" || t === "." || t === ".." || t === "/" || t === "~" || t === "~/" || t.startsWith("../") || (t.endsWith("/*") && (t.startsWith("/") || t.startsWith("~")) && !isTmpPath(t, home, configDir))) return `recursive rm of \`${raw}\` is denied.`;
  const base = baseName(t.endsWith("/") ? t.slice(0, -1) : t);
  if (base === ".git") return `recursive rm of \`${raw}\` is denied (it destroys the repository's history).`;
  const relative = !t.startsWith("/") && !t.startsWith("~") && !t.startsWith("$");
  if (!relative && /(^|\/)\.\.(\/|$)/.test(target.lexical)) return `recursive rm of \`${raw}\` is denied: an absolute path with a \`..\` segment gets no allowance; write the resolved path.`;
  if (isTmpPath(t, home, configDir) || t.includes("/.claude/worktrees/")) return "";
  const expanded = t.startsWith("~") ? home + t.slice(1) : t;
  const abs = relative ? (cwd.startsWith("/") ? joinPosix(cwd, t) : "") : expanded.replace(/\/+$/, "") || "/";
  if (REGENERABLE_DIRS.has(base)) {
    const why = abs ? regenerableExclusion(abs, { home, isRepoRoot: cacheDirCandidate(quotedRaw, abs) ? isRepoRoot : null }) : "";
    if (!why) return "";
    return `recursive rm of \`${raw}\` is denied: ${why}.`;
  }
  if (relative) return "";
  if (home && (expanded === home || expanded === home + "/")) return "recursive rm of the home directory is denied.";
  if (cacheDirCandidate(quotedRaw, expanded) && !reLexicalDots.test(target.lexical)) {
    if (isCacheDir && isCacheDir(abs)) return "";
    if (scratchAncestor(abs, { home, root, isCacheDir, isRepoRoot })) return "";
  }
  return `recursive rm of absolute path \`${raw}\` is denied (only tmp dirs, .claude/worktrees, regenerable build/cache dirs, directories carrying a CACHEDIR.TAG, and paths below one of those inside the repository or home are allowed).`;
}

function joinPosix(dir, rel) {
  const out = dir.replace(/\/+$/, "").split("/");
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/") || "/";
}

const dirNamePosix = (p) => {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
};

function regenerableExclusion(abs, { home, isRepoRoot }) {
  if (abs.split("/").includes(".git")) return "it is inside a `.git` directory";
  if (home && dirNamePosix(abs) === home.replace(/\/+$/, "")) return "a folder directly in the home directory is not treated as a build or cache directory";
  if (isRepoRoot && isRepoRoot(abs)) return "it is the root of a git repository, not a build or cache directory inside one";
  return "";
}

function scratchAncestor(abs, { home, root, isCacheDir, isRepoRoot }) {
  const stops = new Set(["/", home.replace(/\/+$/, ""), root.replace(/\/+$/, "")].filter(Boolean));
  for (let dir = dirNamePosix(abs); !stops.has(dir); dir = dirNamePosix(dir)) {
    if (isRepoRoot && isRepoRoot(dir)) return false;
    if (REGENERABLE_DIRS.has(baseName(dir)) && !regenerableExclusion(dir, { home, isRepoRoot })) return true;
    if (isCacheDir && isCacheDir(dir)) return true;
  }
  return false;
}

function cacheDirCandidate(raw, expanded) {
  if (/^["']/.test(raw) !== /["']$/.test(raw)) return false;
  if (!expanded.startsWith("/") || /[*?[\]{}$`\\]/.test(expanded)) return false;
  return !expanded.split("/").some((seg) => seg === "." || seg === ".." || seg === ".git");
}

const HOME_CACHES = ["Library/Developer/Xcode/DerivedData", ".npm/_npx", ".npm/_cacache", ".bun/install/cache", "Library/Caches/pip", "Library/Caches/go-build", "Library/Caches/Homebrew", "Library/Caches/Yarn", "Library/Caches/ms-playwright", ".cache/puppeteer"];

function isHomeCache(t, home) {
  if (!home) return false;
  const abs = (t.startsWith("~/") ? home + t.slice(1) : t).replace(/\/\*$/, "").replace(/\/+$/, "");
  return HOME_CACHES.some((c) => {
    const base = `${home}/${c}`;
    return abs === base || abs.startsWith(base + "/");
  });
}

function isTmpPath(t, home, configDir = "") {
  if (t === ".." || t.startsWith("../") || t.endsWith("/..") || t.includes("/../")) return false;
  if (reMacTmpDir.test(t)) return true;
  const prefixes = ["/tmp/", "/private/tmp/", "/var/tmp/", "/private/var/tmp/", "$TMPDIR", "${TMPDIR", "$CLAUDE_JOB_DIR", "${CLAUDE_JOB_DIR", "~/.claude/jobs/"];
  if (home) prefixes.push(home + "/.claude/jobs/");
  const cfg = configDir.replace(/\/+$/, "");
  if (cfg.startsWith("/") && cfg !== home) prefixes.push(cfg + "/jobs/");
  return prefixes.some((p) => t.startsWith(p));
}
