# AGENTS.md

This file is the canonical instruction surface for this repository.

Nested `AGENTS.md` files may refine behavior for their own subtree. `AGENT.md` is a compatibility alias only. `README.md` is for orientation and quickstart, not for replacing policy. `docs/` owns architecture, security, testing, release, and decision records.

## Scope

This repository is an Obsidian community-plugin codebase for a GitHub-API-based sync plugin. Treat it as a browser-safe, Obsidian-hosted application first, not as a generic Node.js service.

## Rule precedence

1. Platform and security floors: Obsidian plugin constraints, GitHub security/release rules, and applicable licenses.
2. This root `AGENTS.md`.
3. Path-scoped nested `AGENTS.md` files.
4. Canonical documents under `docs/`.
5. Task-local instructions that narrow scope without weakening the above.

## Non-negotiable rules

1. Preserve the plugin's GitHub-API sync scope unless an ADR explicitly expands it.
2. Default to browser-safe and mobile-safe plugin code. Do not introduce top-level Node.js or Electron dependencies into runtime code without explicit gating and documentation.
3. Do not add telemetry, analytics, or hidden network traffic.
4. Treat tokens, vault paths, and sync logs as sensitive. Never log secrets.
5. Changes to auth, token storage, conflict semantics, or `.obsidian` handling require tests and documentation updates.
6. Do not silently widen what leaves the local vault. README and security docs must disclose any trust-boundary change.
7. Prefer integration over reinvention when the platform or GitHub already provides the needed capability.
8. Do not mark work done until verification evidence exists.

## Required read order for non-trivial work

1. `README.md`
2. `docs/architecture.md`
3. `docs/security-model.md`
4. `docs/testing.md`
5. `docs/release.md`
6. `docs/github-repo-settings.md` when the work touches repository settings, workflows, or security posture
7. relevant ADRs under `docs/decisions/`
8. `src/AGENTS.md` when editing runtime code
9. `tests/AGENTS.md` when editing tests

## Working style

- analyze first
- make the smallest clean change that solves the problem
- verify with commands
- update docs when behavior or trust boundaries changed
- keep follow-up artifacts practical and reusable

## Definition of done

A non-trivial change is not done until all relevant items below are true:

- `npm run validate`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run release:preflight`
- docs and ADRs updated if behavior, security posture, or release policy changed

## Analysis depth rule

When asked to analyze or review, do not stop at the first file. Read transitive constraints: root policy, path policy, canonical docs, relevant tests, workflows, and platform rules.

## Build-vs-integrate rule

Before proposing new custom machinery, check whether Obsidian, GitHub, or GitHub Actions already provide the capability in a safer or simpler way. If integration is better, document that instead of rebuilding casually.
