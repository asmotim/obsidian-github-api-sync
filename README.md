# Obsidian Vault Sync with GitHub

An Obsidian plugin for bidirectional vault sync with GitHub, without requiring a local Git client.

## Status

This repository is an independent continuation of the upstream `FreezingGod/obsidian-github-api-sync` project.
It started as a fork, but it now ships under its own plugin identity and release channel. The current identity decision is recorded in [ADR-0007](docs/decisions/0007-independent-plugin-identity-and-release-channel.md).

## Relationship To Upstream

- this project started as a fork of `FreezingGod/obsidian-github-api-sync`
- upstream provenance remains credited in this repository and its history
- this repository now follows its own roadmap, release process, and maintainer decisions
- focused fixes that are still broadly useful upstream should be proposed back as small, reviewable changes instead of as giant fork-sync PRs

## What the plugin does

- syncs vault content against a GitHub repository through the GitHub REST API
- preserves folder structure and common file operations
- supports conflict handling and sync logs
- supports a configurable remote sync root and an optional local sync root
- supports sync previews, destructive-delete approval, health diagnostics, and baseline repair commands
- uses a built-in shared GitHub App and can suggest available repositories from the installed app
- is intended for Obsidian desktop and mobile because `manifest.json` sets `isDesktopOnly` to `false`

## Security and privacy disclosures

### Network access

Yes. The plugin talks to the GitHub API when the user configures GitHub credentials and runs or schedules sync.

### Account requirement

Yes. You need a GitHub account plus the built-in shared GitHub App installed on the target repository.

### Data leaves your device

Yes. Any files and metadata selected for sync are sent to the configured GitHub repository. That can include note contents, attachment bytes, file paths, and commit metadata. If Remote sync root is set to `Subfolder only`, synced content is constrained to that remote subfolder (for example `vault/`). If Local sync root is set, only that vault-relative subtree is scanned locally.

### Secrets

GitHub App auth stores expiring access and refresh tokens locally inside plugin data so the plugin can refresh your login without sending you through the browser each time. Do **not** sync `.obsidian/` or plugin settings into a public repository when GitHub App auth is enabled.

### Telemetry

This fork does not define telemetry or analytics as an allowed feature. If that ever changes, it requires an ADR, explicit opt-in design, and disclosure updates.

### Mobile support

The plugin is intended to run on desktop and mobile. Each release should still be manually smoke-tested on both before it is treated as release-ready.

## Token permissions

The built-in shared app should have:

- repository contents: read/write
- repository metadata: read

## GitHub App setup

The plugin ships with the shared public GitHub App [`obsidian-github-api-sync-app`](https://github.com/apps/obsidian-github-api-sync-app), so end users do not need to copy a client ID or install URL into Obsidian.

That shared app is expected to have:

- **Enable Device Flow**
- **Expire user authorization tokens** enabled
- repository permissions:
- `Contents: Read & write`
- `Metadata: Read`

For a public repository like this one, only non-secret app metadata such as the client ID or install URL should be stored in the repo or plugin bundle. Do not commit a client secret or private key.

In the plugin settings:

1. click **Install app** if the shared app is not installed on the target repository yet
2. click **Connect**
3. open GitHub, enter the shown device code, and return to Obsidian
4. if the shared app can see repositories already, pick the repository directly from the built-in repository dropdown

The plugin will store the resulting expiring user token locally and refresh it automatically.
The short code confirmation is a GitHub Device Flow requirement; removing that step would require a different web callback-based auth design.

## Repository map

- `src/` — plugin runtime code
- `tests/` — unit and integration tests
- `scripts/` — build, validation, and governance checks
- `docs/` — architecture, security, testing, release, and ADRs
- `.github/` — CI, security, templates, and maintenance workflows

## Remote and local sync roots

**Remote sync root** controls where the plugin reads and writes inside the GitHub repository.

- **Full repository** maps plugin paths directly to repository root.
- **Subfolder only** maps plugin paths into a configured remote subfolder such as `vault/`.

This is useful for monorepo layouts such as:

```text
second-brain/
├─ docs/
├─ policies/
└─ vault/
   ├─ 00 Inbox/
   └─ ...
```

In that setup, configure **Remote sync root = Subfolder only** and **Remote sync root path = vault** so Obsidian-sync content stays inside `vault/`.

**Local sync root (optional)** controls which vault-relative folder is scanned locally before anything is planned or uploaded.

- Leave it empty to sync the whole vault.
- Set it to a folder such as `Journal` if only that local subtree should participate in sync.
- Combine it with the remote setting when local and remote layout should differ.

Examples:

- `Remote sync root = Full repository`, `Local sync root = ""` syncs the entire vault against repository root.
- `Remote sync root = Subfolder only`, `Remote sync root path = vault`, `Local sync root = ""` syncs the entire vault into `vault/` on GitHub.
- `Remote sync root = Subfolder only`, `Remote sync root path = vault`, `Local sync root = Journal` syncs only `Journal/` locally and stores it under `vault/Journal/` remotely.

## Sync safety and diagnostics

The sync path now uses a preview-first safety model for suspicious delete sets and large remote changes:

- **Preview sync plan** stores a dry-run summary, diagnostics, conflicts, and the exact approval key for the current plan.
- **Approve destructive sync and run** is required when the current plan would delete a large share of local files or when the remote side appears unexpectedly wiped.
- **Show sync health** displays the latest preview/sync result plus recent diagnostics such as compare fallbacks, tree truncation fallback, and last seen GitHub rate-limit headers.
- **Repair sync baseline** rebuilds the stored baseline from the current local and remote state when an interrupted run or a large refactor leaves the baseline stale.
- the settings tab includes direct buttons for `Sync now`, `Preview plan`, `Show health`, `Show log`, `Conflicts`, and `Repair baseline`

Internally, the plugin prefers incremental remote fetches, but falls back to a full remote tree fetch when GitHub's compare or tree APIs may be incomplete.
Remote empty folders that are represented in GitHub by `.gitkeep` placeholders are preserved locally as empty folders; the plugin does not need to keep the `.gitkeep` file itself visible inside the vault.

The preview modal is designed as a human-readable decision surface rather than a raw dump: it summarizes what will happen, groups the planned changes by category, and exposes direct actions such as refresh, sync now, approve-and-run, and health lookup.

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

Yes — you can test this plugin locally without submitting to the Obsidian community catalog:

1. run `npm ci` and `npm run build`
2. copy `dist/main.js`, `dist/manifest.json`, and optional `dist/styles.css` into a local Obsidian plugin folder
3. enable the plugin in Obsidian (Settings → Community Plugins)

Use the folder name `obsidian-vault-sync-with-github` for this independent plugin line. If you previously tested either the upstream plugin under `github-api-sync` or an earlier local build of this plugin line under `obsidian-github-api-sync`, remove or disable that older local install first so the plugin identities do not compete in the same vault.

If you want to keep existing plugin settings while moving between plugin IDs:

1. close or reload Obsidian so the old plugin is not actively writing state
2. copy the old `data.json` from `.obsidian/plugins/github-api-sync/` or `.obsidian/plugins/obsidian-github-api-sync/`
3. place that file at `.obsidian/plugins/obsidian-vault-sync-with-github/data.json`
4. start Obsidian again and verify the repository, auth state, and sync health

## Release process

This repository uses a draft-release workflow on SemVer tags. Release readiness requires version sync, passing CI, release assets, `versions.json`, and manual smoke checks. See `docs/release.md` for the full checklist.

## Governance docs

Start here for non-trivial work:

- `AGENTS.md`
- `docs/coding-standards.md`
- `docs/architecture.md`
- `docs/security-model.md`
- `docs/testing.md`
- `docs/release.md`
- `docs/github-repo-settings.md`
- `docs/decisions/`

## Support

- bugs: use the issue templates under `.github/ISSUE_TEMPLATE/`
- security issues: follow `SECURITY.md` and do not post exploit details publicly
