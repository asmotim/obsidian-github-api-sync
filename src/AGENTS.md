# src/AGENTS.md

This file refines the root `AGENTS.md` for runtime code under `src/`.

## Code rules

1. Runtime code must remain compatible with Obsidian plugin execution on desktop and mobile unless explicitly documented otherwise.
2. Prefer Obsidian-supported APIs for network access and filesystem interaction.
3. Do not introduce hidden network endpoints, telemetry, or secondary sync channels.
4. Keep GitHub auth, request construction, sync planning, and conflict handling explicit and typed.
5. Do not broaden `.obsidian` or secret synchronization behavior without an ADR, tests, and disclosure updates.
6. When changing user-visible behavior, update README and the relevant docs in the same change.
7. Add or update tests for planner, engine, conflict, indexer, storage, or client behavior when touched.

## Module map

- `clients/`: GitHub API access and remote operations
- `core/`: sync planning, execution, conflict behavior, orchestration
- `indexers/`: local and remote indexing
- `storage/`: plugin state and persisted sync metadata
- `types/`: shared models and settings
- `ui/`: settings, logs, and conflict-facing UI
- `main.ts`: plugin entrypoint and command registration
