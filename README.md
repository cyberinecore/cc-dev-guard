# devguard

A Claude Code plugin that keeps a session inside its own repository. When Claude is about to Write, Edit or NotebookEdit a file in a different git repository that the session was not given, devguard stops and asks you first. Writes inside the session's repository, its allowed directories (`--add-dir`, `/add-dir`, `additionalDirectories`), gitignored paths and Claude Code's own memory and plan folders pass without a prompt.

Status: pre-release (0.1.0 in development).
