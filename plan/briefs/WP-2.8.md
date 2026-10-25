# WP 2.8 — Themes

**SRD ids:** D19, PLY-24, PLY-26, ADM-18–22 · **Depends on:** 1.6, 2.2 · **Status:** done

## Goal

Runtime theming with inheritance, safe assets, and the admin's theme editor.

## Acceptance

- **`packages/theme`:**
  - token resolution in this order: the object's own theme, then the game theme, then the built-in default (§3 rule 11);
  - mapping to the `--wrx-*` properties, with the derived ones computed (`plan/decisions/ui-stack.md`);
  - a scoped theme provider for any panel (PLY-26);
  - bundled fonts for the `sans`, `serif` and `mono` ids (NFR-7);
  - WCAG 2.2 AA contrast checks (ADM-20).
- **Assets:**
  - PNG, WebP and SVG within the size limit, checked against the server item limit (§3 rule 12);
  - SVG sanitised on upload with DOMPurify;
  - images shown only via `<img>` from a data URL, never inlined.
- **Theme editor** in `packages/admin-ui` (ADM-18–21):
  - a colour picker per token, a font choice, and logo and icon upload;
  - a live preview of the welcome page, a room panel and the force panel;
  - contrast warnings that don't block saving;
  - copy a theme from another force or room, or reset it to inherit.
- **Theme changes** publish live, and clients restyle without logging in again (ADM-22).
- Each pane of the multi-client view themes on its own (PLY-24).
- Unit tests of resolution, contrast and the sanitiser; Playwright screenshots of themed panels.

## Owns

`packages/theme/`, and the themes section of `packages/admin-ui/`.
