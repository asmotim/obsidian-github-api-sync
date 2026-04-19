# ADR-0003: Treat local auth state and plugin settings as sensitive

- Status: accepted
- Date: 2026-04-19

## Context

The plugin authenticates to GitHub and needs repository access to synchronize notes. Local plugin data and `.obsidian/` content may therefore contain credentials, path metadata, sync baselines, and logs that should not be treated as public-by-default.

## Decision

Adopt the following baseline:

- treat local plugin settings and `.obsidian/` data as sensitive surfaces
- do not document or endorse public syncing of plugin settings containing tokens
- do not commit GitHub App client secrets, private keys, refresh tokens, or user access tokens to this public repository

## Consequences

- security guidance can stay specific and least-privilege oriented
- configuration-folder sync remains opt-in work for a later ADR, not an implicit default
- docs and issue templates should avoid asking users to paste tokens or raw settings dumps
