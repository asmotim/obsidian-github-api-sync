# ADR-0004: Prefer explicit conflict handling over silent overwrite

- Status: accepted
- Date: 2026-04-19

## Context

A sync plugin is a multi-writer system in practice: multiple devices, multiple sessions, and remote changes can all race. Silent overwrite would make data loss hard to detect and harder to trust.

## Decision

The fork baseline prefers explicit conflict handling.

That means:

- ambiguity should surface as a conflict or a deterministic documented policy outcome
- changes to conflict policy require tests and documentation updates
- future retry or branch-aware improvements must preserve the no-silent-data-loss principle

## Consequences

- UX work on conflicts is not optional product polish; it is part of the trust model
- planner and engine changes need regression coverage for ambiguous states
