# ADR-0003: Prefer fine-grained PATs and treat local settings as sensitive

- Status: accepted
- Date: 2026-04-19

## Context

The plugin authenticates to GitHub and needs repository access to synchronize notes. The current code path stores configuration locally inside plugin data/settings.

## Decision

Adopt the following baseline:

- prefer fine-grained PATs with repository-scoped access only
- use classic PATs only as fallback for cases fine-grained tokens cannot satisfy yet
- treat local plugin settings and `.obsidian/` data as sensitive surfaces
- do not document or endorse public syncing of plugin settings containing tokens

## Consequences

- security guidance can stay specific and least-privilege oriented
- configuration-folder sync remains opt-in work for a later ADR, not an implicit default
- docs and issue templates should avoid asking users to paste tokens or raw settings dumps
