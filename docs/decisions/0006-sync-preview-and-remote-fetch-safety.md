# ADR-0006: Prefer preview-first delete safety and correctness-first remote fetch fallbacks

- Status: accepted
- Date: 2026-04-20

## Context

This plugin syncs through the GitHub REST API rather than through a local Git client. GitHub's incremental and tree APIs are useful, but they can also return incomplete views when the changed-file list is capped, when compare responses paginate, or when large recursive tree responses are truncated.

At the same time, this plugin is a multi-writer sync system. Large refactors, branch mistakes, or interrupted runs can make a suspicious remote picture look like a mass local delete set. In a public repository context, correctness and clear user confirmation matter more than squeezing every sync into the smallest possible API footprint.

## Decision

Adopt the following sync-safety baseline:

- prefer incremental remote indexing from `compareCommits` when the changed-file list is complete enough to trust
- fall back to a full remote tree fetch when compare results may be incomplete
- walk the remote tree in smaller requests when GitHub reports a truncated recursive tree response
- persist a sync preview and sync health snapshot locally so the latest plan and diagnostics remain inspectable after blocked or failed runs
- require explicit approval before executing suspicious local delete sets, including apparent remote wipe scenarios
- provide an explicit baseline-repair action instead of silently discarding the stored baseline during ordinary sync

## Consequences

- normal sync remains incremental in the common case, but large or ambiguous remote changes deliberately trade extra API calls for correctness
- users can inspect a destructive plan before local files are deleted
- sync diagnostics such as compare fallback, tree truncation fallback, and rate-limit state become part of the persisted local troubleshooting surface
- future changes to safety thresholds, preview persistence, or fallback rules require tests and documentation updates because they affect observable trust behavior
