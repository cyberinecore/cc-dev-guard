import { lstatSync, readdirSync, realpathSync } from "node:fs";
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
const reGitDiscardHead = /\bgit\s+(?:-C\s+\S+\s+)?(checkout|restore)(?=\s)/g;

function pathspecWords(rest) {
  const out = [];
  for (const raw of rest.split(/\s+/)) {
    if (raw === "") continue;
    const cut = raw.search(/[<>;&|)]/);
    const word = (cut < 0 ? raw : raw.slice(0, cut)).replace(/\\\r?\n?/g, "").replace(/["']/g, "");
    if (word !== "") out.push(word);
    if (cut >= 0) break;
  }
  return out;
}

function coversWholeTree(word) {
  const segs = word.split("/").filter((x) => x !== "" && x !== ".");
  return segs.length === 0 || segs[0] === "..";
}

const reGitDiscardLead = /^\s*git\s+(?:-C\s+\S+\s+)?(checkout|restore)(?=\s)/g;

function gitDiscardsAll(s, re = reGitDiscardHead) {
  for (const m of s.matchAll(re)) {
    const words = pathspecWords(s.slice(m.index + m[0].length));
    const dash = words.indexOf("--");
    const options = dash >= 0 ? words.slice(0, dash) : words.filter((w) => w.startsWith("-"));
    if (m[1] === "restore" && options.some((w) => w === "--staged" || w === "-S") && !options.some((w) => w === "--worktree" || w === "-W")) continue;
    const targets = dash >= 0 ? words.slice(dash + 1) : words.filter((w) => !w.startsWith("-")).slice(0, 1);
    if (targets.some(coversWholeTree)) return true;
  }
  return false;
}
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
const TEXT_PREFIX_BINS = new Set(["sudo", "env", "time", "command", "builtin"]);
const GIT_TEXT_SUBCOMMANDS =new Set(["log", "grep", "show", "diff", "blame"]);
const WRAPPER_BINS = new Set(["ssh", "bash", "sh", "zsh", "eval", "xargs", "sudo", "nohup", "timeout", "gtimeout", "caffeinate", "env", "script"]);
const QUOTED_ARG_BINS = new Set(["git", "gh", "glab", "jira", "linear", "curl", "cyberine"]);
const HEREDOC_SINK_BINS = new Set(["cat", "tee"]);
const DATA_READER_BINS = new Set(["cat", "head", "tail", "wc", "sort", "uniq", "cut", "tr", "diff", "comm", "column", "fold", "nl", "od", "xxd", "grep", "rg", "egrep", "fgrep", "ugrep", "tee", "jq", "yq", "base64", "shasum", "sha1sum", "sha256sum", "md5sum", "md5", "cksum", "rev", "paste", "pr", "fmt", "expand", "unexpand", "pbcopy", "xclip", "wl-copy", "cyberine", "amemoria", "gh", "glab", "jira", "linear", "curl"]);
const GIT_STDIN_SUBCOMMANDS = new Set(["commit", "tag", "notes", "hash-object", "apply", "am", "stripspace", "interpret-trailers", "fast-import", "mktag", "mktree"]);
const PY_SAFE_MODULES = new Set(["pathlib", "textwrap", "json", "re", "string", "datetime", "collections", "itertools", "functools", "typing", "dataclasses", "sys", "io", "math", "base64", "hashlib", "shlex", "stat", "time", "fnmatch", "os"]);
const PY_FLAGS = new Set(["-", "-u", "-B", "-E", "-I", "-s", "-S", "-O", "-OO", "-q"]);
const rePyBanned = /\b(?:system|popen|spawn\w*|exec\w*|eval|fork\w*|subprocess|getattr|setattr|delattr|vars|globals|locals|builtins|importlib|breakpoint|modules|ctypes|pty|kill\w*|remove\w*|unlink|rmdir|rmtree|startfile)\b|(?<![\w.])compile\s*\(|\.\s*f?truncate\s*\(/;
const rePyAllowedDunder = /__(?:name|main|file)__/g;
const rePipeOp = /^\|(?!\|)/;
const BINDING_BUILTINS = new Set(["export", "declare", "typeset", "readonly", "local", "read", "unset"]);

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
    if (c === "&" && (cmd[i - 1] === ">" || cmd[i - 1] === "<" || cmd[i + 1] === ">")) {
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
  const arithmetic = /\(\(|\blet\b/.test(text);
  return new RegExp(arithmetic ? String.raw`(?:^|[^\w\${])${name}(?!\w)` : String.raw`(?:^|[^\w\${-])${name}(?!\w)`).test(text);
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
  while (toks.length && (isAssignment(toks[0]) || TEXT_PREFIX_BINS.has(toks[0]) || (toks[0] === "-p" && toks.length > 1))) toks = toks.slice(1);
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

function commandTokens(sub) {
  let toks = fields(sub);
  while (toks.length && (isAssignment(toks[0]) || TEXT_PREFIX_BINS.has(toks[0]) || (toks[0] === "-p" && toks.length > 1))) toks = toks.slice(1);
  return toks;
}

function isDataReader(sub) {
  const toks = commandTokens(sub);
  if (!toks.length) return false;
  const bin = baseName(toks[0]);
  if (bin !== "git") return DATA_READER_BINS.has(bin);
  const rest = toks.slice(1);
  if (rest.some((t) => t === "-c" || t === "--exec-path" || t.startsWith("--exec-path=") || t === "--config-env" || t.startsWith("--config-env="))) return false;
  const sub1 = rest.find((t) => !t.startsWith("-"));
  return sub1 !== undefined && GIT_STDIN_SUBCOMMANDS.has(sub1);
}

function isFeeder(sub) {
  const toks = commandTokens(sub);
  if (!toks.length) return false;
  const bin = baseName(toks[0]);
  return bin === "echo" || bin === "printf" || (TEXT_TOOLS.has(bin) && sub.includes("<<<"));
}

function pipedInto(segments, k) {
  const out = [];
  for (let j = k + 1; j < segments.length && rePipeOp.test(segments[j].op); j++) out.push(segments[j].text);
  return out;
}

function pipeAfterIsReaderOnly(after) {
  if (!after.includes("|")) return true;
  const parts = splitSegments(after);
  return parts.length > 0 && parts.every((p) => rePipeOp.test(p.op) && isDataReader(p.text));
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
  if (!unquotedAt(line, m.index)) return "";
  if (/[<>]\(/.test(line) || /\\\s*$/.test(line) || !pipeAfterIsReaderOnly(after)) return "";
  if ([...line.matchAll(reHeredoc)].length !== 1) return "";
  const sub = before.lastIndexOf("$(");
  const cut = Math.max(sub, before.lastIndexOf("|"), before.lastIndexOf(";"), before.lastIndexOf("&"));
  const head = before.slice(cut + 1).replace(/^\(/, "");
  if (isPythonStdinCommand(head)) return !after.includes("|") && sub < 0 && !before.includes("`") && m[2] !== "" ? "python" : "";
  if (!HEREDOC_SINK_BINS.has(leadingBin(head))) return "";
  if (cut !== sub || sub < 0) return "text";
  const outer = before.slice(0, sub);
  const outerCut = Math.max(outer.lastIndexOf("$("), outer.lastIndexOf("|"), outer.lastIndexOf(";"), outer.lastIndexOf("&"));
  return outerCut < 0 && leadingBin(outer) === "git" ? "text" : "";
}

function isPythonStdinCommand(text) {
  let toks = fields(text);
  while (toks.length && GROUP_OPENERS.has(toks[0])) toks = toks.slice(1);
  if (!toks.length || !/^python(?:3(?:\.\d+)?)?$/.test(baseName(toks[0]))) return false;
  return toks.slice(1).every((t) => PY_FLAGS.has(t));
}

function pythonBodyIsData(body) {
  const text = body.join("\n");
  if (rePyBanned.test(text) || text.replace(rePyAllowedDunder, "").includes("__")) return false;
  const modules = [];
  const rest = text.replace(/(?:^|[;\s])from\s+([\w.]+)\s+import\b/g, (_, mod) => {
    modules.push(mod);
    return " ";
  });
  for (const m of rest.matchAll(/(?:^|[;\s])import\s+([\w., ]+)/g)) {
    for (const part of m[1].split(",")) modules.push(part.trim().split(/\s+/)[0]);
  }
  return modules.every((mod) => PY_SAFE_MODULES.has(mod.split(".")[0]));
}

const GROUP_OPENERS = new Set(["{", "(", "!", "then", "do", "else"]);

function leadingBin(text) {
  let toks = fields(text);
  while (toks.length && (isAssignment(toks[0]) || toks[0] === "sudo" || GROUP_OPENERS.has(toks[0]))) toks = toks.slice(1);
  return toks.length ? baseName(toks[0]) : "";
}

export function stripTextHeredocs(cmd) {
  const lines = cmd.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const docs = [...line.matchAll(reHeredoc)];
    const sink = docs.length === 1 ? heredocSinkOnly(line, docs[0]) : "";
    if (!sink) continue;
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
    if (sink === "python" && !pythonBodyIsData(body)) continue;
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

export function dangerReason(command, { home = "", configDir = "", protectedBranches = DEFAULT_PROTECTED_BRANCHES, awsS3 = true, isCacheDir = null, isRepoRoot = null, root = "", cwd = "", declaredOutput = null } = {}) {
  if (typeof command !== "string" || command === "") return "";
  const opts = { home: home.replace(/\/+$/, ""), configDir, protectedBranches: new Set(protectedBranches), awsS3, isCacheDir, isRepoRoot, root, cwd, declaredOutput };
  return tagWriteShapeReason(command) || guardDepth(command, 0, opts);
}

export function dangerAskReason(command, { home = "", configDir = "", protectedBranches = DEFAULT_PROTECTED_BRANCHES, isCacheDir = null, isRepoRoot = null, root = "", cwd = "", git = null, regenerablePaths = [], named = null } = {}) {
  if (typeof command !== "string" || command === "") return "";
  const opts = { home: home.replace(/\/+$/, ""), configDir, protectedBranches: new Set(protectedBranches), isCacheDir, isRepoRoot, root, cwd, git, regenerablePaths, named };
  return guardDepth(command, 0, opts, subcommandAsk);
}

const WORKTREE_ROUTES = "Leave a session's own worktree with ExitWorktree, remove a background session's worktree with `claude rm <id>`, or run plain `git worktree remove <path>` without --force, which refuses a worktree that holds uncommitted work.";
const GIT_PREFIX_BINS = new Set(["sudo", "env", "command", "nohup", "time", "exec"]);
const SHELL_KEYWORDS = new Set(["do", "then", "else", "!", "{", "("]);
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

const reRedirectWord = /^(?:\d*|&)(?:>>?|<<?|>&|<&)(?:&?\d+|-)?/;

function gitInvocation(sub) {
  const { words, ok } = shellWords(sub);
  if (!ok) return { unparsed: true };
  let i = 0;
  while (i < words.length && (reAssignWord.test(words[i].raw) || GIT_PREFIX_BINS.has(words[i].value) || SHELL_KEYWORDS.has(words[i].value))) i++;
  if (!words[i] || baseName(words[i].value.replace(/^[({]+/, "")) !== "git") return null;
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
  g.args = [];
  for (let j = i + 1; j < words.length; j++) {
    const raw = words[j].raw;
    const m = reRedirectWord.exec(raw);
    if (!m) {
      g.args.push(words[j].value);
      continue;
    }
    if (m[0] === raw && !/&\d$/.test(raw) && !raw.endsWith("-")) j++;
  }
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

const reVaguePath = /[$`*?[]/;
const CONSENT_NAME_MIN = 8;

function declaredPatterns(regenerablePaths, mainRoot) {
  const roots = [...new Set([slashed(mainRoot).replace(/\/+$/, ""), pathKey(mainRoot)])];
  const out = [];
  for (const raw of regenerablePaths || []) {
    const s = slashed(raw).replace(/\/+$/, "");
    const root = roots.find((r) => s.startsWith(r + "/"));
    if (!root) continue;
    const segs = s.slice(root.length + 1).split("/");
    if (segs.some((seg) => seg === "" || seg === "." || seg === ".." || seg === ".git" || seg.includes("**"))) continue;
    out.push(segs.map((seg) => new RegExp("^" + seg.split("*").map((t) => t.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$")));
  }
  return out;
}

const NESTED_WALK_LIMIT = 50000;

function holdsNestedRepo(dir) {
  const stack = [dir];
  let seen = 0;
  while (stack.length) {
    const cur = stack.pop();
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      if (++seen > NESTED_WALK_LIMIT) return true;
      if (e.name === ".git") return true;
      if (e.isDirectory() && !e.isSymbolicLink()) stack.push(joinPosix(cur, e.name));
    }
  }
  return false;
}

export function isDeclaredOutput(dir, { git, regenerablePaths }) {
  try {
    if (!git || !regenerablePaths?.length) return false;
    const real = slashed(realpathSync(dir)).replace(/\/+$/, "");
    const isDir = lstatSync(real).isDirectory();
    const top = slashed(git.strictToplevel(isDir ? real : dirNamePosix(real))).replace(/\/+$/, "");
    if (!top || real === top || !real.startsWith(top + "/")) return false;
    const mainRoot = git.mainRoot(top);
    if (!mainRoot) return false;
    const rel = real.slice(top.length + 1);
    const segs = rel.split("/");
    const patterns = declaredPatterns(regenerablePaths, mainRoot);
    if (!patterns.some((pat) => segs.length >= pat.length && pat.every((re, i) => re.test(segs[i])))) return false;
    if (segs.includes(".git")) return false;
    if (git.ignoreState(top, rel) !== true) return false;
    const tracked = git.trackedUnder(top, rel);
    if (!tracked || tracked.length) return false;
    return !(isDir && holdsNestedRepo(real));
  } catch {
    return false;
  }
}

function worktreeEntryLoss(entry, base, mainRoot, { git, regenerablePaths }) {
  const lost = [];
  const ignored = git.ignoredPaths(entry.path);
  if (!ignored) return { failed: "`git ls-files --ignored` failed" };
  const patterns = declaredPatterns(regenerablePaths, mainRoot);
  const declared = (x) => {
    const segs = x.replace(/\/+$/, "").split("/");
    return patterns.some((pat) => segs.length >= pat.length && pat.every((re, i) => re.test(segs[i])));
  };
  const regenerable = (x) => x.split("/").some((seg) => REGENERABLE_DIRS.has(seg)) || /\.tsbuildinfo$/.test(x);
  const kept = [];
  const folders = [];
  const parentOf = (y) => (y.includes("/") ? y.slice(0, y.lastIndexOf("/")) : "");
  const ignoredDir = new Map();
  const ruleFolder = (y) => {
    const segs = y.replace(/\/+$/, "").split("/");
    for (let i = 1; i < segs.length; i++) {
      const cand = segs.slice(0, i).join("/");
      if (folders.some((d) => d === cand)) return cand;
      if (!ignoredDir.has(cand)) ignoredDir.set(cand, git.isIgnored(entry.path, `${cand}/`));
      if (ignoredDir.get(cand)) return cand;
    }
    return parentOf(y.replace(/\/+$/, ""));
  };
  for (const x of ignored) {
    if (regenerable(x)) continue;
    if (!x.endsWith("/")) {
      if (!declared(x)) {
        kept.push(x);
        folders.push(ruleFolder(x));
      }
      continue;
    }
    const inner = git.ignoredPaths(entry.path, x);
    if (!inner) return { failed: "`git ls-files --ignored` failed" };
    const rest = inner.filter((y) => !regenerable(y) && !(declared(y) && !y.endsWith("/")));
    const left = [...new Set(rest.map((y) => {
      const segs = y.slice(x.length).split("/");
      return segs.length > 1 ? `${x}${segs[0]}/` : y;
    }))];
    kept.push(...left);
    for (const y of rest) {
      const d = ruleFolder(y);
      if (!folders.includes(d)) folders.push(d);
    }
  }
  if (kept.length) lost.push(`ignored files that no commit holds (${listed(kept)})`);
  if (entry.detached && entry.head) {
    const n = git.countRevs(base, [entry.head, "--not", "--branches", "--tags", "--remotes"]);
    if (n === null) return { failed: "`git rev-list` failed" };
    if (n > 0) lost.push(`${n} commit${n === 1 ? "" : "s"} reachable only from its detached HEAD \`${entry.head.slice(0, 12)}\``);
  }
  const declarable = [...new Set(folders.filter((d) => d && !/^\.local(\/|$)/.test(d) && !/(^|\/)\.env/.test(d) && !/(^|\/)\.claude(\/|$)/.test(d)))];
  return { lost, folders: declarable };
}

function vagueTargets(linked, p, base, home) {
  const lit = slashed(p).slice(0, p.search(reVaguePath));
  const cut = lit.lastIndexOf("/");
  if (cut < 0) return linked;
  let dir = lit.slice(0, cut) || "/";
  if (/^~(?:\/|$)/.test(dir)) {
    if (!home) return linked;
    dir = home + dir.slice(1);
  }
  const dirKey = pathKey(resolvePath(base, dir)).replace(/\/+$/, "");
  const prefix = `${dirKey}/${lit.slice(cut + 1)}`;
  return linked.filter((e) => pathKey(e.path).startsWith(prefix));
}

function consentNames(entry, mainRoot) {
  const path = slashed(entry.path).replace(/\/+$/, "");
  const main = slashed(mainRoot).replace(/\/+$/, "");
  const out = [path];
  if (path.startsWith(main + "/")) out.push(path.slice(main.length + 1));
  for (const short of [baseName(path), entry.branch]) if (short && short.length >= CONSENT_NAME_MIN) out.push(short);
  return out;
}

function consentLabel(entry, mainRoot) {
  const names = consentNames(entry, mainRoot);
  const short = baseName(names[0]);
  return short.length >= CONSENT_NAME_MIN ? short : names[1] || names[0];
}

const DECLARE_SHOWN = 8;

function declareHint(lossy, mainRoot) {
  const folders = [...new Set(lossy.flatMap((l) => l.folders))];
  if (!folders.length) return "";
  const shown = folders.slice(0, DECLARE_SHOWN);
  const more = folders.length > shown.length ? ` and ${folders.length - shown.length} more` : "";
  const root = slashed(mainRoot).replace(/\/+$/, "");
  const abs = shown.map((d) => `${root}/${d}`).join(", ");
  const rel = shown.join(", ");
  return ` If these folders are build output, declare them once and they stop counting in every worktree of this repository: ${shown.map((d) => `\`${d}\``).join(", ")}${more}. Only the user can declare them, so report this to the user with both ways: (a) open /config, find the cyberine-devguard options, and add \`${abs}\` to regenerable_paths (comma-separated, after any value already there); or (b) say in their prompt "add CYBERINE_DEVGUARD_REGENERABLE_PATHS to .claude/settings.local.json", and then you add \`"CYBERINE_DEVGUARD_REGENERABLE_PATHS": "${rel}"\` to the env of the gitignored \`${root}/.claude/settings.local.json\` (paths relative to \`${root}\`, joined to any value already there); that write is denied unless the user's prompt in the same turn names the key or the file.`;
}

function worktreeLoss(p, g, { git, home, cwd, regenerablePaths = [], named = null }) {
  const what = `\`git worktree remove ${p}\``;
  if (g.gitDir) return probeFailed(what, "it names --git-dir or --work-tree");
  const base = gitBase(g, { cwd, home });
  if (!base) return probeFailed(what, "the directory git runs in cannot be resolved");
  if (!git) return probeFailed(what, "git is not available to the guard");
  const list = git.worktrees(base);
  if (!list) return probeFailed(what, "`git worktree list` failed");
  const vague = reVaguePath.test(p);
  let targets;
  if (vague) targets = vagueTargets(list.slice(1).filter((e) => !e.bare && e.prunable === null), p, base, home);
  else {
    const want = pathKey(resolvePath(base, /^~(?:\/|$)/.test(p) && home ? home + p.slice(1) : p));
    let entry = list.find((e) => pathKey(e.path) === want);
    if (!entry && !isAbsPath(p)) {
      const tail = "/" + slashed(p).replace(/\/+$/, "");
      const byTail = list.filter((e) => slashed(e.path).endsWith(tail));
      if (byTail.length === 1) entry = byTail[0];
    }
    if (!entry || entry === list[0] || entry.bare || entry.prunable !== null) return "";
    targets = [entry];
  }
  const mainRoot = list[0].path;
  const lossy = [];
  for (const entry of targets) {
    const r = worktreeEntryLoss(entry, base, mainRoot, { git, regenerablePaths });
    if (r.failed) return probeFailed(what, r.failed);
    if (r.lost.length) lossy.push({ entry, ...r });
  }
  if (!lossy.length) return "";
  if (named && lossy.every((l) => named(consentNames(l.entry, mainRoot)))) return "";
  const first = lossy[0];
  const declare = declareHint(lossy, mainRoot);
  const consent = named ? ` Under bypassPermissions the removal also passes once the user names the worktree in their prompt, or picks an AskUserQuestion option whose label names it (\`${consentLabel(first.entry, mainRoot)}\`).` : "";
  if (vague) {
    const more = lossy.length > 1 ? ` (and ${lossy.length - 1} more worktree${lossy.length === 2 ? "" : "s"} under that path hold work)` : "";
    return `${what}: the path is built from a variable, substitution or glob, and of the worktrees it can name, \`${first.entry.path}\` holds ${first.lost.join(" and ")}${more}. Write each path literally so only the worktree you name is checked, or move those files out first.${declare}${consent}`;
  }
  return `${what} deletes ${first.lost.join(" and ")}. Move those files out or delete them once the user says they may go (a copy is not enough: the check looks at what is still in the worktree; regenerable folders such as tmp/, dist/ and node_modules/ do not count), and \`git -C ${first.entry.path} branch <name>\` keeps the commits; or approve only if they may go.${declare}${consent}`;
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
    const n = opts.git.unpushedCommits(base, `refs/heads/${b}`);
    if (n === null) return probeFailed(what, "`git rev-list` failed");
    if (n > 0) return `${what} deletes ${n} commit${n === 1 ? "" : "s"} that no remote has, by commit or by an identical patch. Push the branch first (\`git push -u origin ${b}\`), or approve only if they may go.`;
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

const UNCERTAIN_DANGER = [
  /^recursive rm of .* is denied: the target is a shell variable the guard cannot resolve/,
  /^recursive rm of absolute path /,
  /^recursive rm through `xargs`/,
  /^recursive rm of .* the guard cannot parse its quoting/,
  /the guard could not check what it would delete/,
  /could not be parsed \(unbalanced quoting\)/,
];

export function isUncertainDanger(reason) {
  if (typeof reason !== "string" || reason === "") return false;
  return reason.includes(HEREDOC_NOTE) || UNCERTAIN_DANGER.some((re) => re.test(reason));
}

const HEREDOC_NOTE = " The match is in a heredoc body fed to an interpreter; if that text is data written into a file, write the file with a plain cat heredoc first.";
const QUOTED_NOTE = (bin) => ` The match is inside a quoted string handed to \`${bin}\`, which runs it as a command.`;

function dataAssignments(text) {
  const { words, ok } = shellWords(text);
  if (!ok || !words.length) return null;
  const out = [];
  for (const w of words) {
    const m = reAssignWord.exec(w.raw);
    if (!m) return null;
    if (/\$\(|`|^\(|<\(|>\(/.test(w.raw.slice(m[0].length))) return null;
    out.push({ name: m[1], value: w.value.slice(m[0].length) });
  }
  return out;
}

function expandDataVars(text, vars) {
  let out = text;
  for (const [name, value] of vars) {
    out = out.replace(new RegExp(String.raw`\$(?:\{${name}\}|${name}(?!\w))`, "g"), () => value);
    if (new RegExp(String.raw`\$\{[#!]?${name}(?!\w)`).test(out)) return null;
  }
  return vars.size && /\$\{!/.test(out) ? null : out;
}

function unfollowableUse(text, vars) {
  const [bin] = firstBin(text);
  if (!BINDING_BUILTINS.has(bin)) return "";
  for (const name of vars.keys()) if (mentionsName(text, name)) return name;
  return "";
}

const reLoopStart = /^\s*(?:while|until|for)\b/;
const reLoopEnd = /^\s*done\b/;
const reFindSubstitution = /(?:\$\(|`|<\()\s*(?:sudo\s+)?(?:[^\s;&|`)]*\/)?find\s+([^)`\n;&|]*)/g;
const reFindSubstitutionWord = /^"?(?:\$\(|`)\s*(?:sudo\s+)?(?:[^\s;&|`)]*\/)?find\s/;
const reXargsRm = /(?:^|[\s'"/])(?:rm|unlink)(?=[\s'"]|$)/;

function pipeHead(segments, k) {
  let j = k;
  while (j > 0 && rePipeOp.test(segments[j].op)) j--;
  return j;
}

function findToks(text) {
  let toks = fields(text);
  while (toks.length && (isAssignment(toks[0]) || toks[0] === "sudo" || GROUP_OPENERS.has(toks[0]))) toks = toks.slice(1);
  return toks.length && baseName(toks[0]) === "find" ? toks.slice(1) : null;
}

function readTargets(head) {
  const f = /^\s*for\s+(\w+)\s+in\b/.exec(head);
  if (f) return [f[1]];
  const r = /\bread\b([^\n;&|<>]*)/.exec(head);
  if (!r) return null;
  const toks = fields(r[1]);
  const names = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].startsWith("-")) {
      if (/^-[a-zA-Z]*[dunNpt]$/.test(toks[i])) i++;
      continue;
    }
    if (/^\w+$/.test(toks[i])) names.push(toks[i]);
  }
  return names.length ? names : ["REPLY"];
}

function removesVar(texts, names) {
  const refs = names ? new RegExp(String.raw`\$\{?(?:${names.join("|")})(?!\w)`) : /[$`]/;
  for (const t of texts) {
    for (const call of rmCalls(t)) if (call.targets.some((w) => refs.test(w.raw))) return true;
    const u = /(?:^|[\s;(){}])unlink\s+(\S+)/.exec(t);
    if (u && refs.test(u[1])) return true;
  }
  return false;
}

function loopDeleteReason(segments, vars, opts) {
  const hits = [];
  const stack = [];
  for (let k = 0; k < segments.length; k++) {
    const text = segments[k].text;
    if (reLoopStart.test(text)) stack.push(k);
    else if (reLoopEnd.test(text) && stack.length) {
      const start = stack.pop();
      const region = segments.slice(start, k + 1).map((s) => s.text);
      if (!removesVar(region, readTargets(segments[start].text))) continue;
      const found = [];
      const h = pipeHead(segments, start);
      if (h !== start && findToks(segments[h].text)) found.push({ toks: findToks(segments[h].text), idx: h });
      for (const t of [segments[start].text, text]) for (const m of t.matchAll(reFindSubstitution)) found.push({ toks: fields(m[1]), idx: start });
      for (const f of found) hits.push({ ...f, what: "a per-file delete loop" });
    } else if (leadingBin(text) === "xargs" && rePipeOp.test(segments[k].op) && reXargsRm.test(text.replace(/^\s*xargs/, ""))) {
      const h = pipeHead(segments, k);
      const toks = findToks(segments[h].text);
      if (h !== k && toks) hits.push({ toks, idx: h, what: "`xargs rm`" });
    }
    for (const call of rmCalls(text)) {
      for (const w of call.targets) {
        if (!reFindSubstitutionWord.test(w.raw)) continue;
        for (const m of w.raw.matchAll(reFindSubstitution)) hits.push({ toks: fields(m[1]), idx: k, what: "`rm` of a `find` substitution" });
      }
    }
  }
  for (const { toks, idx, what } of hits) {
    const { roots } = findRoots(toks);
    const hit = findRootsReason(roots, { ...opts, vars: vars[idx] });
    if (hit) return `${what} over \`find ${hit.root} ...\` deletes the files under it one at a time, the same loss as a recursive rm of it, and is denied (${hit.reason}).`;
  }
  return "";
}

function guardDepth(cmd, depth, opts, check = subcommandReason) {
  if (depth > 3) return "";
  const stripped = stripCommentLines(stripTextHeredocs(cmd));
  const bodies = depth === 0 ? heredocBodyLines(stripped) : [];
  const inBody = (text) => bodies.some((l) => l.includes(text.trim()));
  const scans = [];
  const segments = splitSegments(stripped);
  const vars = assignedVars(segments, opts.home);
  const cwds = check === subcommandReason ? null : segmentCwds(segments, opts.cwd, opts.home);
  const dataVars = new Map();
  const allexport = /\bset\s+(?:-[a-zA-Z]*a\b|-o\s+allexport)/.test(stripped);
  const nestedOpts = { ...opts, nested: true };
  for (let k = 0; k < segments.length; k++) {
    const original = segments[k].text;
    const assigned = allexport ? null : dataAssignments(original);
    if (assigned) {
      for (const { name, value } of assigned) {
        const text = expandDataVars(value, dataVars);
        if (text === null) return `the variable assignment \`${name}=...\` builds destructive text from another variable in a form the guard cannot follow.`;
        const clean = text.replace(/["'\\`]/g, " ");
        if (guardDepth(clean, Math.min(depth + 1, 3), nestedOpts, subcommandReason)) dataVars.set(name, clean);
      }
      continue;
    }
    let sub = original;
    if (dataVars.size) {
      const unfollowed = unfollowableUse(original, dataVars);
      if (unfollowed) return `the variable \`${unfollowed}\` holds destructive text and this command passes it on in a form the guard cannot follow (export, read, unset or an expansion with a modifier).`;
      sub = expandDataVars(original, dataVars);
      if (sub === null) return "a variable that holds destructive text is expanded with a modifier the guard cannot follow.";
    }
    if (isTextOnly(sub)) {
      const piped = pipedInto(segments, k);
      const blocker = piped.find((t) => !isDataReader(t));
      if (!isFeeder(sub) || blocker === undefined) continue;
      const receiver = baseName(commandTokens(blocker)[0] || blocker.trim());
      const note = ` The text is piped into \`${receiver}\`, which is not a known data reader and may run it.`;
      scans.push(sub);
      const rf = check(sub, cwds ? { ...opts, vars: vars[k], cwd: cwds[k] } : { ...opts, vars: vars[k] }, sub);
      if (rf) return rf + note;
      for (const inner of quotedStrings(sub)) {
        const ri = guardDepth(inner, depth + 1, nestedOpts, check);
        if (ri) return ri + note;
      }
      continue;
    }
    const [bin] = firstBin(sub);
    const scan = QUOTED_ARG_BINS.has(bin) ? stripQuotedArgs(sub) : sub;
    scans.push(scan);
    const r = check(scan, cwds ? { ...opts, vars: vars[k], cwd: cwds[k] } : { ...opts, vars: vars[k] }, sub);
    if (r) return inBody(original) ? r + HEREDOC_NOTE : r;
    if (isWrapper(sub)) {
      for (const inner of quotedStrings(sub)) {
        const ri = guardDepth(inner, depth + 1, nestedOpts, check);
        if (ri) return depth === 0 ? ri + QUOTED_NOTE(bin) : ri;
      }
    }
  }
  if (check !== subcommandReason) return "";
  const loop = loopDeleteReason(segments, vars, opts);
  if (loop) return loop;
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

function subcommandReason(s, opts, raw = s) {
  if (opts.awsS3 && (reAwsS3Delete.test(s) || reAwsS3ApiDel.test(s))) return "`aws s3 rm/rb` and `aws s3api delete-*` are denied (they delete buckets or objects).";
  if (reSQLDrop.test(s) || reSQLTruncateTable.test(s) || reSQLTruncateLead.test(s) || reSQLTruncateEnd.test(s)) return "DROP DATABASE/SCHEMA/TABLE and TRUNCATE are denied.";
  if (reTerraformDestroy.test(s)) return "`terraform destroy` is denied.";
  if (reKubectlDelete.test(s)) return "`kubectl delete` of a namespace, pv/pvc, statefulset, or --all is denied.";
  if (reDockerPrune.test(s) || reComposeDownV.test(s)) return "`docker system prune`, `docker volume rm/prune` and `docker compose down -v` are denied (they delete volumes).";
  if (reGitResetHard.test(s) || gitDiscardsAll(s) || gitDiscardsAll(raw, reGitDiscardLead) || reGitClean.test(s)) return "`git reset --hard`, `git checkout -- .`, `git restore .` and `git clean -f` discard uncommitted work; denied.";
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

function findRoots(toks) {
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
  return { roots, next: i };
}

function findRootsReason(roots, opts) {
  for (const root of roots) {
    const norm = normalizeTarget(root);
    if (!norm.climbs && norm.path === ".") continue;
    const r = rmTargetReason(root, opts);
    if (r) return { root, reason: r.replace(/\.$/, "") };
  }
  return null;
}

function findReason(cmd, opts) {
  for (const m of cmd.matchAll(reFind)) {
    const toks = fields(m[2]);
    const { roots, next } = findRoots(toks);
    let destructive = "";
    for (let i = next; i < toks.length; i++) {
      if (toks[i] === "-delete") destructive = "-delete";
      if (toks[i] === "-exec" || toks[i] === "-execdir") {
        const rm = execRmAt(toks, i + 1);
        if (rm) destructive = `${toks[i]} ${rm}`;
      }
    }
    if (!destructive) continue;
    const hit = findRootsReason(roots, opts);
    if (hit) return `\`find ${hit.root} ... ${destructive}\` is denied (${hit.reason}).`;
  }
  return "";
}

function execRmAt(toks, i) {
  if (toks[i] === "sudo") i++;
  if (toks[i] === "unlink") return "unlink";
  if (!reRmBin.test(toks[i] || "")) return "";
  for (let j = i + 1; j < toks.length; j++) {
    const t = toks[j];
    if (t === "{}" || t === ";" || t === "\\;" || t === "+") break;
    if (t === "--recursive" || (/^-[a-zA-Z]+$/.test(t) && /[rR]/.test(t))) return "rm -r";
  }
  return "rm";
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
  const { home, configDir, isCacheDir, isRepoRoot, root = "", cwd = "", vars, declaredOutput } = opts;
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
  if (relative) {
    const kept = keptDataSegment(abs || t);
    if (!kept || (declaredOutput && abs && declaredOutput(abs))) return "";
    return `recursive rm of \`${raw}\` is denied: it is at or inside \`${kept}\`, which holds data no commit keeps (notes, credentials, local settings), the same as its absolute path. If it is build output under that folder, the user can declare it in regenerable_paths.`;
  }
  if (home && (expanded === home || expanded === home + "/")) return "recursive rm of the home directory is denied.";
  if (cacheDirCandidate(quotedRaw, expanded) && !reLexicalDots.test(target.lexical)) {
    if (isCacheDir && isCacheDir(abs)) return "";
    if (scratchAncestor(abs, { home, root, isCacheDir, isRepoRoot })) return "";
    if (declaredOutput && declaredOutput(abs)) return "";
  }
  return `recursive rm of absolute path \`${raw}\` is denied (only tmp dirs, .claude/worktrees, regenerable build/cache dirs, directories carrying a CACHEDIR.TAG, paths below one of those inside the repository or home, and ignored, untracked paths the user declared in the regenerable_paths option are allowed).`;
}

function keptDataSegment(p) {
  const segs = p.replace(/\/+$/, "").split("/");
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] === ".local" || /^\.env(\.|$)/.test(segs[i])) return segs.slice(0, i + 1).join("/") || segs[i];
    if (segs[i] === ".claude" && (i === segs.length - 1 || segs[i + 1] === "settings.local.json")) return segs.slice(0, i + 2).join("/");
  }
  return "";
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
