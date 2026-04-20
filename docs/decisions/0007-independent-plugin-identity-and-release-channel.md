# ADR-0007: Adopt an independent plugin identity and release channel

- Status: accepted
- Date: 2026-04-20

## Context

This repository started as a public fork of `FreezingGod/obsidian-github-api-sync`, but it now carries substantial product, security, auth, release, and UX work that is not just a small patch series on top of upstream.

Continuing to ship under the inherited upstream plugin identity would blur provenance, make future releases ambiguous, and create avoidable ecosystem risk for users and reviewers.

## Decision

Adopt the following independent-line baseline:

- treat this repository as an independent continuation that started as a fork of the upstream project
- ship under a distinct plugin identity in `manifest.json`
- use this repository's maintainer/release identity for future releases
- keep explicit attribution to the upstream project in README and related docs
- maintain `versions.json` in the repository root as part of release readiness for an independent Obsidian plugin line
- send only small, focused, upstream-appropriate fixes back to the original repository when they are still broadly applicable

## Consequences

- releases from this repository are no longer ambiguous with upstream releases
- users moving from the upstream plugin to this plugin line must treat it as a distinct install because the plugin ID is different
- documentation and contribution guidance must clearly distinguish between this repository's roadmap and optional upstream backports
- future identity changes should build on this ADR rather than silently reverting to upstream naming
