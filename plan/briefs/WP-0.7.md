# WP 0.7 — Screenshot pipeline

**SRD ids:** DOC-19–21 · **Depends on:** 0.6 · **Status:** to do

## Goal

Repeatable screenshots of changed UI and pages in each PR's bot comment.

## Acceptance

- Playwright scenarios tagged `@screenshot` run on a seeded mock with a fixed clock (DOC-20); two runs on the same commit produce identical images.
- Images are stored with the PR preview and shown in the bot comment; before and after against `main` where a page or scenario existed before (DOC-21).
- The job runs only when a PR touches UI or site files.

## Owns

`tools/screenshots/`, `.github/workflows/screenshots.yml`

## Consumes

The mock seed and clock (from WP 1.4 when available; a static fixture until then).
