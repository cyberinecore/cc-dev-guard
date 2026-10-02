#!/usr/bin/env bash
set -u
here=$(cd "$(dirname "$0")" && pwd -P)
plugin=$(cd "$here/../.." && pwd -P)
wtplugin="$plugin/plugins/cyberine-worktree"
model=${PROBE_MODEL:-haiku}
out=${PROBE_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/dgbm.XXXXXX")}
mkdir -p "$out"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

fixture() {
  local root
  root=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/dgbmfx.XXXXXX")" && pwd -P)
  for r in a b; do
    git init -q -b main "$root/$r"
    git -C "$root/$r" commit -q --allow-empty -m init
  done
  git -C "$root/a" worktree add -q --no-track -B worktree/w "$root/a/.claude/worktrees/w" HEAD
  printf '%s\n' "$root"
}

run() {
  local label=$1 cwd=$2 prompt=$3
  shift 3
  (cd "$cwd" && printf '%s\n' "$prompt" | env "${ENVS[@]}" claude -p --model "$model" --setting-sources project --output-format stream-json --verbose "$@" > "$out/$label.jsonl" 2> "$out/$label.err")
}

reason() {
  jq -r 'select(.type=="user") | .message.content[]? | select(.type=="tool_result") | (.content|tostring)' "$out/$1.jsonl" | grep -m1 -o -E 'cyberine-devguard[:( ][^"]{0,110}' || printf '(no devguard message)'
}

row() {
  local written=no
  [ -e "$3" ] && written=yes
  printf '| %s | %s | %s | %s |\n' "$1" "$2" "$written" "$(reason "$1")"
}

printf '# bash, mcp and worktree-isolation live rows\n\n%s, model %s, %s\n\n' "$(claude --version)" "$model" "$(date -u +%Y-%m-%dT%H:%MZ)"
printf '| row | setup | target written | first devguard message |\n|---|---|---|---|\n'

B='Run exactly this one Bash command, character for character, and nothing else, even if it is refused: `CMD` Then reply DONE.'
F=$(fixture); ENVS=(PROBE=1)
run bash-redirect-control "$F/a" "${B/CMD/echo x > $F/b/ctl.txt}" --dangerously-skip-permissions
row bash-redirect-control "redirect into b, no plugin (positive control)" "$F/b/ctl.txt"
F=$(fixture); ENVS=(PROBE=1)
run bash-redirect "$F/a" "${B/CMD/echo x > $F/b/r.txt}" --plugin-dir "$plugin" --dangerously-skip-permissions
row bash-redirect "redirect into b, devguard, bypass" "$F/b/r.txt"
F=$(fixture); ENVS=(PROBE=1)
run bash-cp-acceptEdits "$F/a" "${B/CMD/touch $F/a/s.txt && cp $F/a/s.txt $F/b/}" --plugin-dir "$plugin" --permission-mode acceptEdits --allowedTools "Bash"
row bash-cp-acceptEdits "cp into b, devguard, acceptEdits + allowedTools Bash" "$F/b/s.txt"
F=$(fixture); ENVS=(PROBE=1)
run bash-same-repo "$F/a" "${B/CMD/echo x > $F/a/same.txt}" --plugin-dir "$plugin" --dangerously-skip-permissions
row bash-same-repo "redirect inside a, devguard, bypass" "$F/a/same.txt"
F=$(fixture); ENVS=(CLAUDE_PLUGIN_OPTION_BASH_GUARD=false)
run bash-guard-off "$F/a" "${B/CMD/echo x > $F/b/off.txt}" --plugin-dir "$plugin" --dangerously-skip-permissions
row bash-guard-off "redirect into b, bash_guard=false" "$F/b/off.txt"

M='Use the filesystem MCP server tool write_file exactly once with path TARGET and content "x". If it is refused, do not retry and do not use any other tool. Reply DONE.'
F=$(fixture); ENVS=(PROBE=1)
printf '{"mcpServers":{"filesystem":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","%s"]}}}\n' "$F" > "$out/mcp-$$.json"
run mcp-control "$F/a" "${M/TARGET/$F/b/mctl.txt}" --mcp-config "$out/mcp-$$.json" --add-dir "$F/b" --dangerously-skip-permissions
row mcp-control "MCP write_file into b, no plugin, --add-dir b so the server's roots include b (positive control)" "$F/b/mctl.txt"
run mcp-write "$F/a" "${M/TARGET/$F/b/m.txt}" --plugin-dir "$plugin" --mcp-config "$out/mcp-$$.json" --dangerously-skip-permissions
row mcp-write "MCP write_file into b, devguard, bypass" "$F/b/m.txt"

W='Use the Write tool once to create the file TARGET with content "x". If it is refused, do not retry and do not use any other tool. Reply DONE.'
F=$(fixture); ENVS=(CLAUDE_PLUGIN_OPTION_ISOLATE_WORKTREES=true)
run isolate-on "$F/a/.claude/worktrees/w" "${W/TARGET/$F/a/from-wt.txt}" --plugin-dir "$plugin" --dangerously-skip-permissions
row isolate-on "Write from worktree w into main a, isolate_worktrees=true" "$F/a/from-wt.txt"
F=$(fixture); ENVS=(PROBE=1)
run isolate-off "$F/a/.claude/worktrees/w" "${W/TARGET/$F/a/from-wt.txt}" --plugin-dir "$plugin" --dangerously-skip-permissions
row isolate-off "Write from worktree w into main a, default" "$F/a/from-wt.txt"

F=$(fixture); ENVS=(PROBE=1); mkdir -p "$F/a/.claude"
printf '{"hooks":{"WorktreeCreate":[{"hooks":[{"type":"command","command":"/opt/other-wt.sh","timeout":30}]}]}}\n' > "$F/a/.claude/settings.json"
run wt-dup-warning "$F/a" "Reply OK." --plugin-dir "$wtplugin"
msg=$(jq -r 'select(.type=="system" and .subtype=="hook_response" and .hook_event=="SessionStart") | .output' "$out/wt-dup-warning.jsonl" | jq -r '.systemMessage? // empty' 2>/dev/null | head -1 | cut -c1-90)
printf '| wt-dup-warning | cyberine-worktree with a second WorktreeCreate hook in project settings | - | %s |\n' "${msg:-(no warning in the stream)}"

printf '\nRaw streams: %s\n' "$out"
