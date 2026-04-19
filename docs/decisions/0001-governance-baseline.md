# ADR-0001: Adopt a lean governance baseline for the fork

- Status: accepted
- Date: 2026-04-19

## Context

The fork currently has working code and tests, but only a minimal repository governance surface. Version drift already exists between `manifest.json` and `package.json`, and the release workflow does not enforce the full validation path before creating a release.

## Decision

Adopt a lean governance spine rather than importing a heavyweight framework.

The baseline includes:

- one canonical root instruction file
- focused architecture, security, testing, release, and repository-settings docs
- a small ADR log
- CI, CodeQL, Dependabot, and governance-audit workflows
- deterministic validation scripts for version sync, README disclosures, and release assets

## Consequences

- the repository gains stronger repeatability without inheriting unrelated operational complexity
- policy placement becomes explicit
- future changes to security, release, and sync semantics have a durable place to land
