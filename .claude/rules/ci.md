# CI/CD facts

Project facts about CI/CD, filled by hand: read the repo's CI config and record what it does — no skill scans it. A re-run appends missing sections and never overwrites an edited one.

## Platform
- Platform: GitHub Actions
- Config: `.github/workflows/ci.yml`

## Deploy triggers
Which push lands where.

- none: every push and pull request runs tests and plugin validation only. Once the plugin is listed, the Anthropic directory picks up new commits on its tracked branch or tag (`main` unless changed in the developer portal), so a push to the tracked ref is a release to directory users.

## Skip CI
Which skip string actually works on this platform.

- `[skip ci]`
