# WP 4.2 — Template composer and card (Annex A, A2)

**SRD ids:** TD3, TD7, TPL-3, TPL-5, TPL-6, TPL-8, TPL-9, PLY-14, PLY-26, PLY-45, NFR-14 · **Depends on:** 4.1 · **Status:** todo

## Goal

Players send and read templated messages. The chat composer offers a template drop-down when the room has templates, shows the chosen template's form, and sends a `template` message; recipients see a card.

## Acceptance

- **RJSF theme:** `@rjsf/core` (versions re-checked) with our own templates and widgets on Radix and `--wrx-*` tokens, themed per room (PLY-26). No Bootstrap or MUI. Template titles and descriptions are rendered as plain text, never markdown or HTML (PLY-14).
- **Widgets:** text and long text (with counters for `maxLength`), number, slider with a number field beside it, yes/no, date and date-time (local display, ISO value, PLY-45), drop-down, linked drop-downs, force picker and role picker fed live from the store, with scope and force filter, storing GUIDs and showing current names or "(deleted)" names.
- **Composer:** template drop-down plus "Free text" when allowed (TD3); with free text off and no templates for the role, the composer says so and cannot send. Validation errors inline before send; the size cap (PLY-53) checked before send. Unsent form values are kept like unsent text (PLY-49). Fits narrow tabs and the multi-client panes.
- **Card (TD7, TPL-5):** template name, then each field's label and value in schema order, in the existing grouping and virtualised list; picker values as names. An invalid message shows as plain text with a warning; a not-permitted one as a card with a warning (provisional 3).
- **Accessibility:** keyboard-only send of every widget, labelled fields, errors announced; axe clean on the composer and card.
- **Tests:** unit tests for widgets and the card; e2e on the mock: send each field type, receive in another pane, a hostile client's invalid message shows as plain text; on ejabberd one round trip. Tagged screenshots of the composer and a card.

## Notes

Image and asset pickers are not in this WP (A5, deferred).
