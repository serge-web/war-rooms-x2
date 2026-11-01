# WP 4.4 — Template acceptance and review (Annex A, A4)

**SRD ids:** Annex A as a whole, T-R1, T-R2, NFR-11, NFR-14 · **Depends on:** 4.2, 4.3 · **Status:** todo · **Security review required**

## Goal

Prove templated rooms end to end, and review them.

## Acceptance

- **Scenario SC-10** on the mock and ejabberd: the admin builds a template, assigns it to one force in a room with free text off, publishes; a player of that force sends it; a player of another force sees the card but cannot send it; the admin copies the locked template, changes it, republishes; old messages still show with the old template; a deleted role in a role picker shows "(deleted)".
- **Performance:** a room of 2,000 templated messages scrolls within the NFR-11 budgets; validation cost per message measured.
- **Accessibility:** axe and keyboard checks on every new screen.
- **Security review** of T-R1 (hostile values, permission drift, validator agreement, rendering), the `templates` node access, and lock-on-publish, in `plan/reviews/phase-4-security-notes.md`, each finding fixed or listed for the owner.
- **Docs:** SRD Annex A updated to what was built (including the provisional answers), the data dictionary, a site page on templates, and the phase 4 gate post.
