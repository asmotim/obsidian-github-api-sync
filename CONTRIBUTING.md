# Contributing

Thanks for contributing.

## Ground rules

- prefer pull requests over direct pushes to `main`
- keep changes small and reviewable
- preserve existing plugin behavior unless the change intentionally updates behavior and documents it
- do not introduce real secrets, tokens, or private vault data into the repository, issues, screenshots, or tests
- do not change plugin identity (`id`, `name`, authoring/release identity) casually; see ADR-0007 first
- this repository is an independent continuation, not a mirror-sync fork; upstream PRs should be small and focused when they still apply cleanly there

## Before you open a PR

Run:

```bash
npm ci
npm run validate
npm run typecheck
npm run lint
npm test
npm run build
npm run release:preflight
```

## When docs are required

Update docs in the same change when you modify:

- auth or token handling
- network or trust boundaries
- conflict semantics
- release behavior
- mobile or platform assumptions
- user-visible settings or commands

## Testing expectations

- code changes should include tests or a clear explanation of why tests are not practical
- sync bugs should come with a regression test when feasible
- manual smoke checks are required before a release is published

## Pull request quality bar

A good PR usually includes:

- a focused summary of the problem and change
- notes about user-visible impact
- relevant docs/ADR updates
- proof of validation commands
