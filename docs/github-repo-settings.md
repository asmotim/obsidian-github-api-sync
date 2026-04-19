# GitHub Repository Settings Checklist

Some important governance and security controls cannot be enforced by tracked files alone. Apply these settings in the GitHub repository UI.

## Recommended settings

### 1. Protect `main` with Branch Protection or Repository Rules

Require at least:

- pull requests for changes to `main`
- at least one review
- passing status checks for CI before merge
- no force-pushes
- no branch deletion for the protected branch

### 2. Set default GitHub Actions token permissions to read-only

Escalate permissions per job only where needed, such as the draft release job.

### 3. Enable private vulnerability reporting

This makes `SECURITY.md` actionable and avoids forcing reporters into public issues.

### 4. Enable Dependency Graph and Dependabot alerts

Allow GitHub to surface vulnerable dependencies and open update PRs.

### 5. Enable Code Scanning results

The included CodeQL workflow is more useful when code scanning is visible in the Security tab.

### 6. Enable secret scanning / push protection where available

Especially valuable for a repository that discusses GitHub tokens and Actions.

## Optional but useful

- Discussions for design proposals and usage questions
- repository rulesets instead of legacy branch protection when available
- artifact attestations and signed-release hardening in a later phase
