# WP 0.5 — Repo scaffold

**SRD ids:** D18, NFR-7, NFR-15–19, NFR-22, DOC-22 · **Depends on:** — · **Status:** done

## Goal

A monorepo where every later WP can add a package, with CI enforcing the quality rules from the first commit.

## Acceptance

- pnpm workspace with `packages/*` and `apps/*`; one `tsconfig.base.json` with `strict` and `noUncheckedIndexedAccess`.
- ESLint (typescript-eslint, type-checked): no `any`, no unsafe member access or assignment, and a local rule `wrx/no-module-mutable-state` (ARC-2) on all `src` code.
- Vitest for unit tests, with a coverage report.
- Playwright with one smoke test of the web app's shell, which shows the backend in use (PLY-1).
- `apps/web` builds as a static site with relative asset URLs (DOC-11) and no runtime CDN calls (NFR-7); CI checks the build for absolute `http(s)://` asset references.
- CI on every push and PR: install, type check, lint, unit tests, build, Playwright, Mermaid check of the README and every `.md` file, traceability check (SRD ids against the plan).
- PR template with the checklist from the plan (tests, site content, screenshots, plan chart).
- README opens with the plan chart (DOC-22).

## Owns

Repo root config, `.github/`, `tools/`, `apps/web/` (until WP 2.4 takes it).

## Deferred (see Plan changes)

- ejabberd CI job → WP 1.2, when the contract suite exists.
- Storybook (NFR-18) → WP 2.4, with the first presentational components.
