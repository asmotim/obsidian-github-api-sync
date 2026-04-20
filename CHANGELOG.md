# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- governance baseline documents, ADRs, contribution guidance, and repository setting checklist
- CI, CodeQL, Dependabot, and governance-audit workflows
- version-sync, README disclosure, and release-asset verification scripts
- `versions.json` for the repository's independent plugin-release line
- GitHub App device-flow auth with shared-app setup, local token refresh, and installed-repository discovery
- sync preview, sync health, destructive-delete approval, and baseline-repair workflows
- stricter TypeScript/ESLint/Stylelint/script-quality baselines and coding-standards documentation

### Changed

- the visible plugin name now ships as `Obsidian Vault Sync with GitHub`
- plugin identity now ships as the independent `obsidian-vault-sync-with-github` line instead of reusing the upstream manifest identity
- package metadata now aligns with the independent plugin slug and the README documents how to migrate `data.json` from older plugin IDs
- repository policy now treats this project as an independent continuation that still credits and selectively backports to upstream where appropriate
- package metadata version alignment policy tightened around `manifest.json` and `package.json`
- release workflow hardened to verify build, version, and release assets before creating a draft release
- README rewritten as an orientation and disclosure surface instead of a catch-all policy store
- settings now expose direct sync/preview/health/repair actions and a simpler shared-app repository picker
- preview output is grouped into human-readable sections instead of a raw text dump
