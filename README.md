# GitHub API Sync

A bidirectional Obsidian sync plugin that uses the GitHub API instead of a local Git client.

## Status

This repository is currently a governance and hardening fork of the upstream `FreezingGod/obsidian-github-api-sync` codebase. The code and manifest identity still track the upstream plugin for now. Until `docs/decisions/0002-fork-identity-and-release-policy.md` is deliberately resolved, this fork should be treated as a development fork rather than a separate public release channel.

## What the plugin does

- syncs vault content against a GitHub repository through the GitHub REST API
- preserves folder structure and common file operations
- supports conflict handling and sync logs
- supports syncing either to repository root or to a dedicated remote subfolder (for example `vault/`)
- is intended for Obsidian desktop and mobile because `manifest.json` sets `isDesktopOnly` to `false`

## Security and privacy disclosures

### Network access

Yes. The plugin talks to the GitHub API when the user configures GitHub credentials and runs or schedules sync.

### Account requirement

Yes. You need a GitHub account, a repository, and a token with repository access.

### Data leaves your device

Yes. Any files and metadata selected for sync are sent to the configured GitHub repository. That can include note contents, attachment bytes, file paths, and commit metadata. If repository scope is set to `Subfolder only`, synced content is constrained to that remote subfolder (for example `vault/`).

### Secrets

By default, the token is session-only and is **not** persisted on disk unless you explicitly enable **Persist token on disk** in settings. Do **not** sync `.obsidian/` or plugin settings into a public repository if token persistence is enabled.

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

## Repository scope modes

- **Full repository**: plugin paths map directly to repository root.
- **Subfolder only**: plugin paths map into a configured repository subfolder (default: `vault`).

This mode is useful for monorepo layouts such as:

```text
second-brain/
├─ docs/
├─ policies/
└─ vault/
   ├─ 00 Inbox/
   └─ ...
```

In that setup, configure **Repository scope = Subfolder only** and **Repository subfolder = vault** so Obsidian-sync content stays inside `vault/`.

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

## Test without catalog submission

Yes — you can test this fork locally without submitting to the Obsidian community catalog:

1. run `npm ci` and `npm run build`
2. copy `dist/main.js`, `dist/manifest.json`, and optional `dist/styles.css` into a local Obsidian plugin folder
3. enable the plugin in Obsidian (Settings → Community Plugins)

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
