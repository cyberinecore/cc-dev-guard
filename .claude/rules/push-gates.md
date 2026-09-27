<!-- nf-rulegen:scaffold name=push-gates by=nf-vibe-coding tpl=1 sha=bb0e83562e702fa0269abd9b2790f856a1f0abd3b89833b733d97bb93541a004 -->
# Push gates

Project facts that gate auto-commit / push, filled by hand. A re-run appends missing sections and never overwrites an edited one. The `:section` comment is the section's identity — keep it, rename the heading freely. Empty means nothing beyond the rules already loaded, not nothing exists.

## Protected branches
<!-- nf:section protected-branches -->

One branch per bullet.

- main

## Preconditions
<!-- nf:section preconditions -->

Commands that must pass before any push to a protected branch.

## Branch conventions
<!-- nf:section branch-conventions -->

Project-specific naming or flow beyond the global git rule.
