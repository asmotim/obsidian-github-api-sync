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
- auth refresh, repository discovery, and log-redaction behavior
- compare overflow, tree truncation fallback, and conditional GET handling
- empty-folder placeholder handling for remote `.gitkeep` directories

### 2. Integration-style tests

Use integration-style tests for:

- sync engine orchestration
- end-to-end planner/executor behavior across multiple components
- regression cases involving rename, delete, conflict, and baseline handling
- preview generation, destructive-delete approval, and baseline repair flows

### 3. Manual smoke tests for release candidates

Before publishing a release from this repository, manually smoke-test:

- macOS desktop
- Windows desktop
- at least one mobile client path consistent with the current support target

Release smoke should verify at minimum:

- plugin enables successfully
- plugin installs under the independent plugin ID `obsidian-vault-sync-with-github` and does not conflict with a leftover local install of the upstream `github-api-sync` plugin or an older local fork install under `obsidian-github-api-sync`
- migrating `data.json` from `github-api-sync` or `obsidian-github-api-sync` into `obsidian-vault-sync-with-github` preserves usable settings and local auth state
- settings save/load correctly
- a sync run can complete against a test repository
- GitHub App device-flow login can complete on at least one desktop path and one mobile path when that auth mode is enabled
- stored GitHub App auth refreshes without asking the user to log in again when the token is near expiry
- preview / approve-and-run / health / repair-baseline commands remain usable and readable
- settings-tab quick-action buttons trigger the same flows as the command palette
- repository selection through the shared GitHub App still fills owner/repo correctly when multiple repos are installed
- conflict UI remains accessible
- log view remains readable

## Change-to-test matrix

| Change type | Expected validation |
| --- | --- |
| planner / engine logic | targeted tests plus integration coverage |
| auth / token / request handling | unit tests plus docs update (including token persistence behavior) |
| repository root vs subfolder sync scope | targeted tests for path mapping and conflict handling |
| delete-safety thresholds / preview / repair flows | targeted tests, integration coverage, docs, and ADR review |
| UI-only change | at least a focused regression check and manual smoke |
| workflow / release / scripts | local script execution or CI evidence |
| trust-boundary change | tests, docs, and ADR |

## Prohibited test behavior

- no real GitHub API traffic in standard tests
- no real secrets in fixtures
- no dependence on private vault content
- no tests that only pass when run in a maintainer-specific local environment
