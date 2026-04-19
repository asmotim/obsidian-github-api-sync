# ADR-0005: Prepare GitHub App device-flow auth without adding app secrets to the public repo

- Status: accepted
- Date: 2026-04-19

## Context

The plugin originally authenticated with a personal access token stored in local plugin settings. The target user experience is a simpler sign-in flow that works on desktop and mobile without teaching users to create long-lived PATs manually.

This repository is public, so GitHub App private keys, OAuth client secrets, or any equivalent server-side secret material must never be committed here or embedded into the plugin bundle.

## Decision

Adopt the following GitHub App baseline:

- route runtime GitHub access through an auth manager instead of reading credentials directly at call sites
- use the built-in shared GitHub App as the only supported end-user auth path
- store expiring access and refresh tokens in a separate local auth-state surface
- keep GitHub App secret material out of the repository and out of the shipped plugin
- allow shipping public shared-app metadata such as the client ID and install URL to remove manual setup for users
- accept the short Device Flow code confirmation as the current desktop/mobile-compatible login tradeoff

## Consequences

- the repository can ship a functional device-flow login without committing any GitHub App secret material
- end users authenticate through the built-in shared app without copying IDs or URLs into Obsidian
- plugin settings no longer need to persist PAT-specific configuration
- a callback-based web login remains possible later, but would require a separate ADR because it changes the trust boundary and setup model
