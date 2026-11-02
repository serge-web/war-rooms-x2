# WP 4.4 — Template acceptance and review (Annex A, A4)

**SRD ids:** Annex A as a whole, T-R1, T-R2, NFR-11, NFR-14 · **Depends on:** 4.2, 4.3 · **Status:** done · **Security review required**

## Goal

Prove templated rooms end to end, and review them.

## Acceptance

- **Scenario SC-10** on the mock and ejabberd: the admin builds a template, assigns it to one force in a room with free text off, publishes; a player of that force sends it; a player of another force sees the card but cannot send it; the admin copies the locked template, changes it, republishes; old messages still show with the old template; a deleted role in a role picker shows "(deleted)".
- **Performance:** a room of 2,000 templated messages scrolls within the NFR-11 budgets; validation cost per message measured.
- **Accessibility:** axe and keyboard checks on every new screen.
- **Security review** of T-R1 (hostile values, permission drift, validator agreement, rendering), the `templates` node access, and lock-on-publish, in `plan/reviews/phase-4-security-notes.md`, each finding fixed or listed for the owner.
- **Docs:** SRD Annex A updated to what was built (including the provisional answers), the data dictionary, a site page on templates, and the phase 4 gate post.

## Notes (done)

- **SC-10** (`apps/web/e2e/scenarios/sc-10-templated-room.spec.ts`, SRD §12) passes on the mock and on ejabberd. It found a room-settings bug: unticking a force's last template hid its row (fixed, unit test).
- **Preview.** The admin's live preview is now WP 4.2's `TemplateForm` (`@wrx/player-ui/templates`), the default of `AdminApp`'s `templatePreview` slot; pickers come from the draft's forces and roles with `retired: []` and a unique id prefix. Drop-downs and linked drop-downs start empty (`constAsDefaults: 'never'`), yes/no fields at no, as in the composer; problems show on Check, then live.
- **Performance** (`plan/reviews/phase-4-performance.md`): a room of 2,000 templated messages meets NFR-11; the receiver's check costs about 22 µs per message.
- **Accessibility:** axe on every template screen and keyboard-only sending of every field type (recorded in `phase-3-accessibility.md`). Two advisory-browser failures from WP 4.2 fixed: the keyboard test no longer depends on Chromium's date-time field, and the composer's buttons no longer cover the slider's number box in WebKit. Firefox and WebKit are not installed in this environment, so those two fixes are unverified there.
- **Security review** (`plan/reviews/phase-4-security-review.md`): H1, patterns ran on over-long values, fixed in `@wrx/templates` (for the owner); M1, M2, L1 to L3 recorded.
- **Ports:** `WRX_MOCK_HOST_E2E_PORT`, `WRX_SHOTS_PORT`, `WRX_ADMIN_UI_E2E_PORT` and `WRX_THEME_E2E_PORT` move the e2e and screenshot servers.
- **Docs:** SRD Annex A "As built", the data dictionary's profile description, `site/pages/templates.md`, and the gate post `site/pages/blog/phase-4-message-templates.md` (blog posts may now be phase 4).
