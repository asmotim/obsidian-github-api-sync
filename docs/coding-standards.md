# Coding Standards

## Scope

These standards apply to runtime TypeScript under `src/`, tests under `tests/`, build and governance scripts under `scripts/`, and plugin CSS in `styles.css`.

## TypeScript and JavaScript

- prefer explicit, narrow types over `any`
- runtime code must not use `any`; tests may use narrowly scoped `as any` only at Obsidian/runtime mocking boundaries when a typed fake would add more noise than safety
- use `import type` for type-only imports
- treat async flows as first-class:
  - do not leave promises floating
  - do not pass async functions into void callbacks without wrapping them
- only throw `Error` values
- keep switch statements exhaustive when they model unions or enums
- runtime code must stay browser-safe and mobile-safe
- build/governance scripts must be `// @ts-check` compatible and pass `tsconfig.scripts.json`

## Documentation Conventions

- use TSDoc-style `/** */` comments for exported APIs whose behavior is non-obvious
- document invariants and trust-boundary assumptions, not obvious syntax
- especially document:
  - auth/token lifecycle rules
  - sync planning assumptions
  - conflict semantics
  - path filtering and `.obsidian` boundaries

## Security Rules

- never log tokens, raw authorization headers, refresh tokens, or client secrets
- avoid raw HTML injection APIs such as `innerHTML`, `outerHTML`, and `insertAdjacentHTML`
- do not use `eval` or dynamic `Function` construction
- prefer centralized logging/redaction helpers over ad-hoc `console.*` in runtime code
- build and governance scripts may write explicit status lines to stdout/stderr, but must never print secrets

## Efficiency Rules

- prefer incremental sync logic when safe, but fall back to full remote fetches when GitHub responses may be incomplete
- use conditional GETs and other GitHub REST best practices where appropriate
- avoid unnecessary DOM churn in UI code
- favor CSS transform/opacity animations over layout-triggering properties

## CSS

- keep selectors low-specificity and plugin-prefixed
- use Obsidian theme variables instead of hard-coded colors where possible
- honor `prefers-reduced-motion`
- keep the stylesheet small and intentionally organized; avoid one-off overrides that fight the host theme
