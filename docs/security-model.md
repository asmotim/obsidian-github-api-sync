# Security Model

## Assets to protect

- vault note content and attachments
- GitHub tokens and repository credentials
- sync baseline data and file metadata
- release artifacts and CI credentials
- user trust around what data leaves the device

## Trust model

### Local side

The plugin runs inside Obsidian and can read the vault paths it is pointed at. Local plugin data and settings are therefore sensitive.

### Remote side

The configured GitHub repository and branch act as the remote sync target. Data sent there is outside the local-only trust boundary.
When repository scope is set to a subfolder, only that configured remote subtree is used for plugin sync data.

### CI/CD side

GitHub Actions may build and package the plugin, but ordinary CI should not need production sync tokens.

## Token policy

Preferred:

- fine-grained PAT
- repository-scoped only
- contents read/write
- metadata read

Fallback:

- classic PAT with `repo` for private repositories or `public_repo` for public repositories

Operational rules:

- one token per user or device where practical
- rotate on exposure or device loss
- default to session-only token handling (do not persist token unless explicitly enabled by the user)
- do not print tokens in logs
- do not embed tokens in fixtures, screenshots, or issue reports

## Configuration folder policy

The baseline policy treats `.obsidian/` and plugin settings as sensitive surfaces.

That means:

- no default promise that `.obsidian/` is safe to sync
- no public-repo examples that include plugin settings with tokens
- any attempt to broaden configuration sync requires an ADR, tests, and disclosure updates

## Public repository warning

Using a public GitHub repository for synced notes is a conscious publication decision. The plugin should not imply that GitHub-based sync is private unless the user configures a private repository.

## Telemetry policy

This fork does not allow hidden telemetry or analytics. Any future observability feature must be explicit, documented, opt-in where appropriate, and reviewed as a trust-boundary change.

## Release and workflow policy

- default GitHub Actions token permissions should stay minimal
- write permissions should be granted only to the jobs that need them
- branch protection / repository rules should require review and passing checks for `main`
- security reporting should use GitHub private vulnerability reporting when available
