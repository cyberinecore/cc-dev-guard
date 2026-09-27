# Privacy policy

devguard is a Claude Code plugin that runs only on your computer. This policy covers the plugin as published at https://github.com/cyberinecore/cc-dev-guard.

## What it collects

Nothing leaves your computer. devguard makes no network requests, has no telemetry, and sends no data to its author, to Anthropic, or to anyone else.

## What it reads locally

To decide whether a file write stays inside the session's repository, devguard reads, on your machine only: the tool call Claude Code hands to the hook (tool name and file path), Claude Code settings files (only `permissions.additionalDirectories`, `autoMemoryDirectory`, and the `env` keys for devguard's own options), `.claude/devguard.json` files, the `--add-dir` arguments and start directory of the running `claude` process, and git metadata of the repositories involved. It does not read your conversation: the session transcript is opened only if you turn on the `read_transcript` option, and then only its environment snapshot (working directory and allowed directories) is parsed.

## What it stores locally, and for how long

Inside its Claude Code plugin data directory (`~/.claude/plugins/data/<id>/`):

- the directories you added with `/add-dir`, per session, deleted after 7 days;
- empty marker files in `deny-once` mode, deleted after 10 minutes;
- only if you turn on `log_decisions`: one line per stopped write with the time, session id, tool, file path and verdict, kept until you delete it or uninstall the plugin.

Claude Code deletes the data directory when you uninstall the plugin (unless you pass `--keep-data`).

## Children

devguard is a developer tool and is not directed at children under 18.

## Contact

Questions or concerns: open an issue at https://github.com/cyberinecore/cc-dev-guard/issues or email xinchao@nghia-pham.com. Security reports: see `SECURITY.md`.

## Changes

Changes to this policy are published in this file in the repository, with the history kept by git.
