# Testing

## Goals

The test strategy should prove sync correctness, protect trust boundaries, and keep mobile-capable runtime assumptions honest.

## Required command set

```bash
npm run validate
npm run typecheck
npm run lint
npm test
npm run build
npm run release:preflight
```

## Test layers

### 1. Unit tests

Use unit tests for:

- GitHub client behavior
- local and remote indexers
- planner logic
- conflict resolution
- state-store behavior

### 2. Integration-style tests

Use integration-style tests for:

- sync engine orchestration
- end-to-end planner/executor behavior across multiple components
- regression cases involving rename, delete, conflict, and baseline handling

### 3. Manual smoke tests for release candidates

Before publishing a release from this fork, manually smoke-test:

- macOS desktop
- Windows desktop
- at least one mobile client path consistent with the current support target

Release smoke should verify at minimum:

- plugin enables successfully
- settings save/load correctly
- a sync run can complete against a test repository
- conflict UI remains accessible
- log view remains readable

## Change-to-test matrix

| Change type | Expected validation |
| --- | --- |
| planner / engine logic | targeted tests plus integration coverage |
| auth / token / request handling | unit tests plus docs update (including token persistence behavior) |
| repository root vs subfolder sync scope | targeted tests for path mapping and conflict handling |
| UI-only change | at least a focused regression check and manual smoke |
| workflow / release / scripts | local script execution or CI evidence |
| trust-boundary change | tests, docs, and ADR |

## Prohibited test behavior

- no real GitHub API traffic in standard tests
- no real secrets in fixtures
- no dependence on private vault content
- no tests that only pass when run in a maintainer-specific local environment
