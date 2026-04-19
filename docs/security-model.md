# Security Model

## Assets to protect

- vault note content and attachments
- GitHub tokens and repository credentials
- sync baseline data and file metadata
- release artifacts and CI credentials
- user trust around what data leaves the device

## Trust model

### Local side

The plugin runs inside Obsidian and can read the vault paths it is pointed at. Local plugin data, settings, and stored GitHub App auth state are therefore sensitive.

### Remote side

The configured GitHub repository and branch act as the remote sync target. Data sent there is outside the local-only trust boundary.
When Remote sync root is set to a subfolder, only that configured remote subtree is used for plugin sync data. When Local sync root is set, only that configured vault subtree is scanned locally before sync planning.

### CI/CD side

GitHub Actions may build and package the plugin, but ordinary CI should not need production sync tokens.

## Token policy

GitHub App baseline:

- device flow enabled
- expiring user access tokens enabled
- repository contents: read/write
- repository metadata: read

Operational rules:

- one token per user or device where practical
- rotate on exposure or device loss
- GitHub App auth persists expiring access and refresh tokens locally so silent refresh can work across app restarts
- the plugin may ship public GitHub App metadata such as the shared app client ID and install URL
- do not print tokens in logs
- redact token-shaped values before persisting sync logs or writing runtime warnings/errors
- do not embed tokens in fixtures, screenshots, or issue reports
- do not commit GitHub App client secrets or private keys to this public repository
- clear stored GitHub App auth state on disconnect

## Sync safety rules

- large or suspicious local delete sets must surface as a stored preview that requires explicit approval before execution
- remote comparison fallbacks must prefer correctness over a cheaper but potentially incomplete remote picture
- sync preview and health records may contain path metadata and should be treated as sensitive local state
- baseline repair is an explicit user action; ordinary sync should not silently discard the last known baseline when the remote picture looks suspicious

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
