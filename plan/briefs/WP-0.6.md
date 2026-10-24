# WP 0.6 — Site and PR previews

**SRD ids:** NFR-1, DOC-1–2, DOC-6–9, DOC-11–16, DOC-23–26 · **Depends on:** 0.5 · **Status:** to do

## Goal

The public site on `gh-pages`, with an interactive mock build of every PR.

## Acceptance

- Site generator chosen (DOC-15) and building offline, with Mermaid rendering and an embedded demo.
- Sections: background, architecture, technical details, data dictionary (from WP 0.8's generator), blog, PR index (DOC-1, DOC-9).
- Workflows:
  - PR preview to `pr/<n>/`, with one bot comment updated in place (DOC-6, DOC-7);
  - a merged PR's preview kept, a closed one's removed (DOC-8);
  - `demo/` deployed on every push to `main` (DOC-16);
  - one deploy queue, retried on conflict (DOC-13);
  - blog-only PRs auto-merge when CI is green, refused if anything outside the blog folder changes, with a frozen snapshot at `snapshots/<slug>/` (DOC-23–26).
- Checks: a deny-list scan (DOC-2), with the list itself kept out of the site; a size report warning at 70% (DOC-14); a bundle scan for secrets and real-server endpoints (NFR-1, DOC-12).

## Owns

`site/`, `.github/workflows/site-*.yml`, `tools/site/`

## Consumes

`apps/web` build output; `packages/schemas` dictionary generator.

## Notes

- The deny-list names security terms, so it must not itself be published. Keep it in `tools/site/` and outside the site's source folder.
- R18 (repo visibility) is still open. If the repo stays public, the deny-list protects the site but not the source.
