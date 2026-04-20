# Release Process

## Versioning contract

This repository uses Semantic Versioning.

At release time, the following must agree:

- `manifest.json` version
- `package.json` version
- `package-lock.json` root version
- the Git tag used for the release

## Current release mode

The baseline workflow creates a **draft GitHub release** from a SemVer tag after verification passes. Draft mode is intentional so the maintainer can review artifacts and notes before publication.

Releases from this repository are independent releases of this plugin line, not upstream releases.

## Required assets

Each release must attach:

- `main.js`
- `manifest.json`
- `styles.css` when the project ships one

The repository root must also keep a current `manifest.json`.
The repository root must also keep a current `versions.json` for the independent plugin line.

## Commands before tagging

```bash
npm ci
npm run validate
npm run typecheck
npm run lint
npm test
npm run build
npm run release:preflight
```

## Tagging rule

Use the exact version number as the tag, for example:

```bash
git tag 1.0.5
git push origin 1.0.5
```

Do not use a `v` prefix unless release policy is explicitly changed.

## Manual review before publishing a draft release

- changelog updated
- README disclosures still accurate
- manual smoke run completed on the intended platforms
- no unresolved security or token-handling concerns
- ADR-0007 still respected; release metadata still matches this repository's independent plugin identity

## Community-plugin readiness

This repository now maintains `versions.json` as part of release readiness for an independent plugin line.
Before any community-plugin submission, verify that manifest identity, release assets, and repository metadata all still match this repository's independent plugin identity.
