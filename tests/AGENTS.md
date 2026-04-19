# tests/AGENTS.md

This file refines the root `AGENTS.md` for `tests/`.

## Test rules

1. Tests must be deterministic and must not call the live GitHub API.
2. Use fake tokens and sanitized fixture data only.
3. Regression tests are required for planner, engine, conflict, state-store, and indexer bugs.
4. If a fix changes observable sync behavior, add or update at least one test that would have failed before the fix.
5. Keep test names explicit about the scenario and expected outcome.
6. Prefer small focused tests first, then integration-style tests when cross-module behavior matters.
