#!/usr/bin/env bash
set -u
here=$(cd "$(dirname "$0")" && pwd -P)
plugin=$(cd "$here/../.." && pwd -P)
wtplugin="$plugin/plugins/cyberine-worktree"
model=${PROBE_MODEL:-haiku}
out=${PROBE_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/dgwt.XXXXXX")}
mkdir -p "$out"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

mkrepo() { git init -q -b main "$1" && git -C "$1" commit -q --allow-empty -m init; }

fixture() {
  local root
  root=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/dgwtfx.XXXXXX")" && pwd -P)
  mkrepo "$root/plain"
  mkrepo "$root/subsrc"
  mkrepo "$root/outer"
  git -C "$root/outer" -c protocol.file.allow=always submodule add -q "$root/subsrc" sub
  git -C "$root/outer" commit -q -m sub
  mkrepo "$root/nest"
  git -C "$root/nest" worktree add -q --no-track -B worktree/parent "$root/nest/.claude/worktrees/parent" HEAD
  printf '%s\n' "$root"
}

listing() {
  git -C "$1" worktree list --porcelain | awk -v r="$2" '/^worktree /{p=$2; sub(r"/", "", p)} /^branch /{b=$2; sub("refs/heads/", "", b); print p" ["b"]"}' | tail -n +2 | tr '\n' ' '
}

claude_run() {
  local label=$1 cwd=$2 prompt=$3
  shift 3
  (cd "$cwd" && printf '%s\n' "$prompt" | claude -p --model "$model" --setting-sources project --output-format stream-json --verbose "$@" > "$out/$label.jsonl" 2> "$out/$label.err")
}

row() {
  printf '| %s | %s | %s |\n' "$1" "$2" "$3"
}

version=$(claude --version)
printf '# worktree live matrix\n\n%s, model %s, %s\n\n' "$version" "$model" "$(date -u +%Y-%m-%dT%H:%MZ)"
printf '| row | setup | result (worktrees after the run, relative to the fixture) |\n|---|---|---|\n'

F=$(fixture)
claude_run cli-w-plain "$F/plain" "Reply OK." --plugin-dir "$wtplugin" -w probe
row cli-w-plain "-w probe in plain, cyberine-worktree" "$(listing "$F/plain" "$F")"

F=$(fixture)
claude_run cli-w-submodule "$F/outer/sub" "Reply OK." --plugin-dir "$wtplugin" -w subprobe
row cli-w-submodule "-w subprobe in outer/sub, cyberine-worktree" "$(listing "$F/outer/sub" "$F")"

F=$(fixture)
claude_run agent-isolation "$F/plain" 'Use the Agent tool exactly once with subagent_type "general-purpose", isolation "worktree", and the prompt "Run pwd and git branch --show-current with Bash and report both lines verbatim." Then reply with its report.' --plugin-dir "$wtplugin" --dangerously-skip-permissions
row agent-isolation "Agent isolation worktree in plain, cyberine-worktree" "$(listing "$F/plain" "$F")"

F=$(fixture)
claude_run agent-isolation-nested "$F/nest/.claude/worktrees/parent" 'Use the Agent tool exactly once with subagent_type "general-purpose", isolation "worktree", and the prompt "Run pwd with Bash and report it verbatim." Then reply with its report.' --plugin-dir "$wtplugin" --dangerously-skip-permissions
row agent-isolation-nested "Agent isolation worktree from nest/.claude/worktrees/parent, cyberine-worktree" "$(listing "$F/nest" "$F")"

F=$(fixture)
claude_run enter-worktree "$F/plain" 'Use the EnterWorktree tool exactly once with name "entered". Then run pwd with Bash and reply with it.' --plugin-dir "$wtplugin" --dangerously-skip-permissions
row enter-worktree "EnterWorktree name=entered in plain, cyberine-worktree" "$(listing "$F/plain" "$F")"

B='Run exactly this one Bash command, character for character, with no extra arguments, and nothing else, even if it is refused: `CMD` Then reply DONE.'
F=$(fixture)
claude_run bash-tmp-control "$F/plain" "${B/CMD/git worktree add $F/tmp-control}" --dangerously-skip-permissions
row bash-tmp-control "git worktree add <fx>/tmp-control, no plugin (positive control)" "$(listing "$F/plain" "$F")"

F=$(fixture)
claude_run bash-tmp "$F/plain" "${B/CMD/git worktree add /tmp/dgwt-stray-$$}" --plugin-dir "$plugin" --dangerously-skip-permissions
row bash-tmp "git worktree add /tmp/..., devguard, bypass" "$(listing "$F/plain" "$F")"
git -C "$F/plain" worktree remove --force "/tmp/dgwt-stray-$$" 2>/dev/null

F=$(fixture)
claude_run bash-sibling "$F/plain" "${B/CMD/git -C $F/plain worktree add ../sibling}" --plugin-dir "$plugin" --dangerously-skip-permissions
row bash-sibling "git -C plain worktree add ../sibling, devguard, bypass" "$(listing "$F/plain" "$F")"

F=$(fixture)
claude_run bash-inside "$F/plain" "${B/CMD/git worktree add .claude/worktrees/ok}" --plugin-dir "$plugin" --dangerously-skip-permissions
row bash-inside "git worktree add .claude/worktrees/ok, devguard, bypass" "$(listing "$F/plain" "$F")"

F=$(fixture)
claude_run bash-tmp-acceptEdits "$F/plain" "${B/CMD/git worktree add $F/tmp-ae}" --plugin-dir "$plugin" --permission-mode acceptEdits --allowedTools "Bash(git worktree add:*)"
row bash-tmp-acceptEdits "git worktree add <fx>/tmp-ae, devguard, acceptEdits + allowedTools" "$(listing "$F/plain" "$F")"

printf '\nRaw streams: %s\n' "$out"