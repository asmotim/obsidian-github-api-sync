# Security Policy

## Supported versions

This fork has not published an independent stable release line yet.

| Version | Supported |
| --- | --- |
| `main` | :white_check_mark: active development |
| tagged fork releases before an explicit fork policy decision | :x: not yet supported as a stable channel |

## Reporting a vulnerability

Preferred channel: **GitHub Private Vulnerability Reporting** for this repository.

Maintainer action: enable private vulnerability reporting in the repository settings before the first independent fork release.

If private reporting is not yet enabled:

1. **Do not** open a public issue with exploit details.
2. Open a minimal issue that only asks for a private security contact, or contact the maintainer through the repository owner profile without including the exploit details publicly.
3. Wait for a private channel before sharing proof-of-concept material.

## Handling expectations

Please include, when possible:

- affected version or commit
- impact summary
- reproduction steps
- whether a secret, token, or private note content could be exposed

## Project-specific security rules

- least-privilege GitHub tokens only
- no telemetry or hidden exfiltration
- no secrets in tests, fixtures, logs, screenshots, or releases
- `.obsidian/` and other configuration files are treated as sensitive surfaces by default
