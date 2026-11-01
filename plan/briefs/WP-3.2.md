# WP 3.2 — Performance, scale, browsers and accessibility

**SRD ids:** NFR-11, NFR-12, NFR-13, NFR-14 · **Depends on:** Phase 2 · **Status:** done

## Goal

Measure the v1 targets in a real browser and meet them, and check the UI against WCAG 2.2 AA.

## Acceptance

- **Scale (NFR-11):** a seeded game with 50 roles, 30 rooms and 10,000 messages in a room. Measured in Chromium: a room tab renders in under 1 s, scrolling stays smooth, and the publish plan and the access matrix stay usable. The numbers are recorded, and a CI check guards against regressions with a generous margin.
- **Multi-client (NFR-12):** four panes; a message sent from one shows in all four within 1 s, and typing shows no visible lag (measured input-to-paint).
- **Browsers (NFR-13):** a CI job runs the app e2e suite in Firefox, and in WebKit as an advisory job (Safari is a SHOULD). Locally only Chromium is installed, so these run in CI only. Failures are fixed, or recorded with the reason.
- **Accessibility (NFR-14):**
  - axe-core checks on every main screen (welcome, login, workspace, chat, column, admin sections, publish, audit, multi-client);
  - a keyboard-only pass through the main tasks, including the alternatives to drag and drop;
  - focus order and visible focus;
  - screen-reader names, including the unread count on room tabs (a gap left by WP 2.5);
  - colour contrast of the default theme.
  
  Findings are fixed, or recorded in `plan/reviews/phase-3-accessibility.md` with the reason they stay.

## Owns

Performance fixtures and tests, the browser CI jobs, axe tests, and the fixes they need.
