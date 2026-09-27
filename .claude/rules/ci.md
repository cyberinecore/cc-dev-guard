<!-- nf-rulegen:scaffold name=ci by=nf-vibe-coding tpl=1 sha=04b2eb30907b274cefda4c58dc938654312fc9af218e73d74c974c8d96ff2648 -->
# CI/CD facts

Project facts about CI/CD, filled by hand: read the repo's CI config and record what it does — no skill scans it. A re-run appends missing sections and never overwrites an edited one.

## Platform
<!-- nf:section platform -->

- Platform: GitHub Actions
- Config: `.github/workflows/ci.yml`

## Deploy triggers
<!-- nf:section deploy-triggers -->

Which push lands where.

- none: every push and pull request runs tests and plugin validation only. Once the plugin is listed, the Anthropic directory picks up new commits on its tracked branch or tag (`main` unless changed in the developer portal), so a push to the tracked ref is a release to directory users.

## Skip CI
<!-- nf:section skip-ci -->

Which skip string actually works on this platform.

- `[skip ci]`
