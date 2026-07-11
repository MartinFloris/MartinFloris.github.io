# AGENTS.md

This file provides guidance to ChatGPT and Codex when working with code in this repository.

## Canonical project guidance

Before doing repository work, read [`CLAUDE.md`](CLAUDE.md) in full and follow it as project guidance. It is the canonical description of the project, commands, architecture, generated-file workflow, deployment boundaries, and frozen attestation integrity constraint.

Do not duplicate that guidance here: keeping a single canonical project description prevents Claude and Codex instructions from drifting apart. If the project architecture or workflow changes, update `CLAUDE.md`; this file will continue to direct Codex to it.

## Codex-specific safety and permissions

- Repository-local Codex hooks and command rules live under `.codex/` and require the repository to be trusted.
- The pre-tool hook blocks destructive shell operations such as recursive forced deletion, force pushes, remote-branch deletion, hard resets, forced Git cleans, broad checkout-based discards, and piping downloads directly into interpreters.
- Normal `git push` and `gh run ...` commands are allowed by the repository command rules. Never force-push.
- Pushing `main` publishes the static site immediately. Treat any push or deployment as an external side effect: only do it when the user's request authorizes it.
- Changes under `worker/` are not deployed by a GitHub Pages push; deploy them separately with Wrangler only when explicitly requested.

