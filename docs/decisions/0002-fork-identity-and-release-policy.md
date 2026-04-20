# ADR-0002: Keep fork identity unresolved until explicitly decided

- Status: superseded by ADR-0007
- Date: 2026-04-19

## Context

This repository is a public fork of the upstream plugin. The code and manifest still use the upstream plugin identity, while the fork currently has no published releases of its own.

## Decision

Do not change plugin identity casually.

Until a deliberate follow-up decision is made:

- keep the existing manifest identity as inherited upstream behavior
- treat this repository as a hardening/development fork, not a distinct release channel
- do not submit the fork as a separate community plugin or publish stable fork releases without an explicit identity decision

## Consequences

- contributors avoid accidental ecosystem breakage
- README must disclose the fork status clearly
- the first independent release from this fork requires a deliberate identity/release decision

## Superseded by

- `0007-independent-plugin-identity-and-release-channel.md`
