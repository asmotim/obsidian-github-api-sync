# GitHub API Sync

A bidirectional Obsidian sync plugin that uses the GitHub API instead of a local Git client.

## Status

This repository is currently a governance and hardening fork of the upstream `FreezingGod/obsidian-github-api-sync` codebase. The code and manifest identity still track the upstream plugin for now. Until `docs/decisions/0002-fork-identity-and-release-policy.md` is deliberately resolved, this fork should be treated as a development fork rather than a separate public release channel.

## What the plugin does

- syncs vault content against a GitHub repository through the GitHub REST API
- preserves folder structure and common file operations
- supports conflict handling and sync logs
- is intended for Obsidian desktop and mobile because `manifest.json` sets `isDesktopOnly` to `false`

## Security and privacy disclosures

### Network access

Yes. The plugin talks to the GitHub API when the user configures GitHub credentials and runs or schedules sync.

### Account requirement

Yes. You need a GitHub account, a repository, and a token with repository access.

### Data leaves your device

Yes. Any files and metadata selected for sync are sent to the configured GitHub repository. That can include note contents, attachment bytes, file paths, and commit metadata.

### Secrets

The current fork assumes GitHub credentials are stored locally in plugin data/settings. Do **not** sync `.obsidian/` or plugin settings into a public repository unless token handling is redesigned and documented.

### Telemetry

This fork does not define telemetry or analytics as an allowed feature. If that ever changes, it requires an ADR, explicit opt-in design, and disclosure updates.

### Mobile support

The plugin is intended to run on desktop and mobile. Each release should still be manually smoke-tested on both before it is treated as release-ready.

## Token permissions

Preferred minimum:

- fine-grained personal access token with repository-scoped access only
- repository contents: read/write
- repository metadata: read

Fallback for classic tokens:

- `repo` for private repositories
- `public_repo` for public repositories

## Repository map

- `src/` — plugin runtime code
- `tests/` — unit and integration tests
- `scripts/` — build, validation, and governance checks
- `docs/` — architecture, security, testing, release, and ADRs
- `.github/` — CI, security, templates, and maintenance workflows

## Development

```bash
npm ci
npm run validate
npm run typecheck
npm run lint
npm test
npm run build
npm run release:preflight
```

Build artifacts land in `dist/`.

## Release process

This fork uses a draft-release workflow on SemVer tags. Release readiness requires version sync, passing CI, release assets, and manual smoke checks. See `docs/release.md` for the full checklist.

## Governance docs

Start here for non-trivial work:

- `AGENTS.md`
- `docs/architecture.md`
- `docs/security-model.md`
- `docs/testing.md`
- `docs/release.md`
- `docs/github-repo-settings.md`
- `docs/decisions/`

## Support

- bugs: use the issue templates under `.github/ISSUE_TEMPLATE/`
- security issues: follow `SECURITY.md` and do not post exploit details publicly
