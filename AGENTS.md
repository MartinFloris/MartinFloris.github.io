# AGENTS.md

This file provides guidance to ChatGPT and Codex when working with code in this repository.

## Canonical project guidance

Before doing repository work, read [`CLAUDE.md`](CLAUDE.md) in full and follow it as project guidance. It is the canonical description of the project, commands, architecture, generated-file workflow, deployment boundaries, and frozen attestation integrity constraint.

Do not duplicate that guidance here: keeping a single canonical project description prevents Claude and Codex instructions from drifting apart. If the project architecture or workflow changes, update `CLAUDE.md`; this file will continue to direct Codex to it.

## Codex-specific safety and permissions

- Repository-local Codex hooks and command rules live under `.codex/` and require the repository to be trusted. See global `~/.codex/AGENTS.md` for the agent safety policy and push/deployment discipline these hooks enforce.
- Normal `git push` and `gh run ...` commands are allowed by the repository command rules.
- Pushing `main` publishes the static site. How the deploy is gated, and why `worker/` deploys on a separate path, are described in `CLAUDE.md` (the `Site deploy` bullet under Commands, and `Deployment independence`) — read them there rather than relying on a summary in this file.
- Run `python scripts/check_site.py` locally before pushing, and never run a Wrangler deploy unless explicitly asked.

