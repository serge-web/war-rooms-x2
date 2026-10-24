# WP 0.7 — Screenshot pipeline

**SRD ids:** DOC-19–21 · **Depends on:** 0.6 · **Status:** done

## Goal

Repeatable screenshots of changed UI and pages in each PR's bot comment.

## Acceptance

- Playwright scenarios tagged `@screenshot` run on a seeded mock with a fixed clock (DOC-20); two runs on the same commit produce identical images.
- Images are stored with the PR preview and shown in the bot comment; before and after against `main` where a page or scenario existed before (DOC-21).
- The job runs only when a PR touches UI or site files.

## Owns

`tools/screenshots/`, and the screenshot steps in `.github/workflows/site-build.yml` (see Notes)

## Consumes

The mock seed and clock (from WP 1.4 when available; a static fixture until then).

## Notes

- The screenshots run inside the site build, not in a separate `screenshots.yml`, so they deploy with the preview they belong to.
- "Before" images come from `main`'s published `screenshots/` folder on `gh-pages`, not from a second build of `main`. That saves a build, but `main` must deploy once with screenshots before PRs have anything to compare with.
- Images are compared by SHA-256. Each build takes them twice and fails if the runs differ, which keeps the hashes meaningful.
- Until 1.4 provides seeds, the app shell is the only UI scenario. Seeded scenarios are added with 1.4 and 2.x.
