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

## Required assets

Each release must attach:

- `main.js`
- `manifest.json`
- `styles.css` when the project ships one

The repository root must also keep a current `manifest.json`.

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
- ADR-0002 still respected; do not publish a distinct fork release channel accidentally

## Future community-plugin track

If this fork becomes an independently published Obsidian community plugin, add and maintain `versions.json` and resolve fork identity/release policy explicitly before submission.
