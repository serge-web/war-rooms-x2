# Phase 4 security review: message templates (internal)

WP 4.4, 2 November 2026. Scope: SRD Annex A as built in WPs 4.1 to 4.3 and the 4.4 changes, against T-R1 (hostile values, permission drift, validator agreement, rendering), T-R2 (size), the `templates` node's access, and lock-on-publish. Not for the public site (DOC-2): it describes what the server does not enforce.

This is an independent read of the code at the head of the WP 4.4 branch, not a summary of the builders' notes in `phase-4-security-notes.md`; where it agrees with them it says so briefly. Each finding is probed with a test where it can be. Earlier reviews: `v1-security-review.md` (findings F1 to F11) and the phase 2 and 3 notes.

## Ratings

| Rating | Meaning |
| --- | --- |
| Critical | A player gains access or authority they should not have, or reads what their force should not see |
| High | A player can deny service to other players, or corrupt what other players see, without special access |
| Medium | Integrity or availability harm that needs the admin's action, or a trusted role's |
| Low | A known limit of the design (D2: the server enforces membership and voice only), or harm limited to the actor's own client |
| Info | No harm found; recorded so the next reviewer need not re-derive it |

The product owner decides on anything rated High or Critical. H1 is fixed and tested below; the product owner confirmed the High rating and the fix on Nov 2, 2026.

## Summary

| Id | Finding | Rating | State |
| --- | --- | --- | --- |
| H1 | An over-long value made every receiver run the field's pattern on 8,000 characters: minutes of main-thread work per message | High | Fixed, tested; rating and fix confirmed by the owner (Nov 2, 2026) |
| M1 | A lock fixes the schema only: the admin can relabel a locked template's fields (`ui:title`), reorder them, and rename the template, which changes how past messages read | Medium | Fixed (Nov 2, 2026): the owner chose to lock labels, order and name too; planner, audit and editor refuse them, with tests |
| M2 | Removing a locked template turns its messages into plain text for good | Medium | Recorded: deliberate, confirmed one by one; the owner's pending answer |
| L1 | A modified client can send a template its role is not offered, or free text in a templates-only room | Low | Accepted by design (D2, T-R1); the first is marked, the second cannot be |
| L2 | A modified client can use a template no published room offers, so it is not locked, and a later edit by the admin changes how that message reads | Low | Recorded |
| L3 | A picker's room scope and force filter are not checked on receipt | Low | Accepted by design (drift) |
| I1 | The `templates` node: read by every role, published by the admin only, nothing below it touched | Info | Verified |
| I2 | Validator agreement between composer and receivers | Info | Verified |
| I3 | Rendering: names, labels, hints and values are text only | Info | Verified |
| I4 | Identity and permission come from the stanza, never the body | Info | Verified |
| I5 | Size: bodies capped by the server's stanza limit and the schemas | Info | Verified |
| I6 | CSP: no eval or `new Function` in the template code paths | Info | Verified |
| I7 | `fast-uri` 4.2.3's age, and `markdown-to-jsx` in the bundle | Info | Recorded |

## Findings

### H1: patterns ran on over-long values (High, fixed)

**What.** A text field with a `pattern` must keep `maxLength` at 200 or less, and `unsafePattern` allows at most three variable quantifiers on single atoms, so a pattern's worst case is polynomial with a small degree. That bound holds only for values of at most 200 characters. The message body schema allows any string up to 8,000 characters, and the validator (`@cfworker/json-schema`, created with `shortCircuit: false` so the composer can mark every field) evaluates every keyword: a value over `maxLength` was still tested against the pattern.

**Probe.** `^a*a*a*b$` passes the profile. On the receiver's validator, `'a'.repeat(n)`: 200 characters 16 ms, 1,000 characters 156 ms, 2,000 characters 1.1 s, 4,000 characters 9.0 s. 8,000 characters extrapolates to over a minute.

**Impact.** Any player with a voice in any room could post a templated message naming any template that has a patterned field (templates are game-wide, not per room, and the schema is checked before permission), with an 8,000-character value. Every client in the room then freezes on receipt, and again on every login while the message is in the history (MAM), until the admin removes the template. No special access is needed. This is the T-R1 "hostile values" risk that the profile was meant to close.

**Fix.** `createTemplateValidator().validate` (`packages/templates/src/validate.ts`) now compares each declared text field's value with its `maxLength`, counted in code points as JSON Schema counts it. A value over the limit is reported as "is too long" and left out of the schema run, so neither its `pattern` nor its `format` runs on it. The other fields are validated as before. The composer's RJSF adapter uses the same function, so sender and receiver still agree.

**Tests.** `validate.test.ts`: "refuses a text over its maxLength without running its pattern on it" (8,000 characters in under 200 ms, against minutes before; at the limit the pattern still runs) and "counts maxLength in code points".

**Residual.** Patterns and formats now run on at most 200 and 40 characters respectively, which the profile's existing test bounds. **For the owner:** confirm the rating and the fix.

### M1: a lock fixes the schema only (Medium, fixed)

**What.** `templateLockErrors` (`packages/admin-ops/src/publish/plan.ts`) refuses a change to a locked template's `schema`, compared as canonical JSON. The `uiSchema`, `name` and `description` stay editable. Cards take each field's label from `ui:title` before the schema's `title` (`fieldLabel`, `packages/player-ui/src/templates/card.ts`) and their order from `ui:order`. So after a publish, the admin can relabel the fields of a locked template, and every past message's card reads differently, for example "Approve the strike: Yes" becoming "Cancel the strike: Yes". The values and schema titles are unchanged, but nothing on the card shows that the labels changed.

**Who.** The admin only (TD2): a trusted actor who also designs the game. It is still a quiet way to change how the game's record reads, which matters for an after-action review.

**Fixed.** The product owner chose (Nov 2, 2026) to lock labels, order and name as well. `templateLockErrors` now compares the name and the whole `uiSchema` (absent equals empty) as well as the schema; the audit uses the same check; `updateTemplate` ignores those changes on a locked template and the editor shows the name read only. Tests: `plan.test.ts` (name, labels, order refused; description allowed), `templates.test.ts` (draft), the admin-ui e2e (name read only). **Before the fix:** what a lock covers was one of the owner's pending decisions. The cheap fix, if the owner wants it, is to compare each field's `ui:title` (and `ui:order`, if order matters) with the schema in `templateLockErrors`, and make them read only in the editor.

### M2: removing a locked template (Medium, recorded)

**What.** The planner allows dropping a locked template from the design. The publish retracts its item after the rooms stop offering it, and from then on its messages fail the "known template" check and show as plain text with a warning, for good. The retraction is a destructive step: confirmed one by one in the apply dialog and in the audit's repair (`stepConfirmation`, `template:<id>`), and its warning says whether the template was locked.

**Why recorded.** It is deliberate: a new design that replaces a published game must be publishable, as it can delete roles and destroy rooms. The plain text keeps every value with its field name, so nothing is lost but the card. Whether this needs more than a confirmation is one of the owner's pending decisions.

### L1: advisory template rules (Low, by design)

As T-R1 says: the server enforces membership and voice only (D2). A modified client can post a template its role is not offered in the room. Receivers show it as a card with the warning "This room does not offer … to the sender now" (provisional answer 3). A modified client can also post free text in a templates-only room, and no receiver can tell it from a message sent before free text was turned off, so it shows as ordinary chat. Both are known and accepted in the design record. Template content is never used for identity or permission (I4).

### L2: using a template that is not locked (Low, recorded)

Lock-on-publish assumes a template can be used only once a published room offers it. A modified client can name any template in the `templates` node, including one no room offers yet, which is therefore unlocked. If the admin then edits that template's schema, the message is re-checked against the new schema and may turn into plain text or read differently. Such a message is always shown with the not-permitted warning from the start, since no room offers the template, so readers are warned. Not fixed: locking every published template on publish would stop the admin from refining templates before offering them, which TD6 does not ask for.

### L3: picker scope and filter on receipt (Low, by design)

`checkTemplatedMessage` checks that a picker value is the GUID of a known or deleted force or role of the right kind, but not the field's `x-wrx-scope: room` or `x-wrx-force` filter. Room participants and forces change after a message is sent, so checking against today's would turn old, valid messages into plain text. A modified client can therefore name a role outside the filter. Picker values are display data only (TPL-8), never identity or permission, so the harm is a misleading card, from a client that could equally have typed the name.

### I1: the `templates` node

Checked in `packages/admin-ops/src/target.ts`, `packages/schemas/src/nodes.ts` and the contract check T01:

- a whitelist leaf, every role affiliated as a member (read), the admin its owner and only publisher, `max_items` 500, which matches the design limit, so ejabberd never silently drops an old template;
- the affiliations follow roles as every other whitelist node does (`everyRole('read')`), so a deleted role loses read access with its account;
- `RESERVED_NODE_PREFIXES` keeps the tooling and the client away from anything below `templates`;
- contract T01 on both backends: players read, a player's publish is refused, an anonymous session is refused, and the item size limit holds.

Templates are readable by every role (provisional answer 5). A template's name and fields must not reveal one force's plans to another; the editor says so to the admin. If the owner rules them confidential, they move to per-force nodes.

### I2: validator agreement

The composer validates with `createTemplateFormValidator`, an RJSF adapter over the same `createTemplateValidator().validate` the receivers use, against the same `validationSchemaOf` (no undeclared fields, picker values GUID-shaped). The store's `sendTemplateMessage` then runs the receiver's full `checkTemplatedMessage`, so an unmodified client never sends what receivers refuse. The H1 fix is inside the shared function, so agreement holds. The admin's preview now uses the same form (WP 4.4), so the admin sees the same checks.

### I3: rendering

Template names, descriptions, field titles, `ui:title`, hints, placeholders, option titles and values are rendered as React text in our own RJSF templates and widgets and in the card. The profile refuses every UI option outside a short list, including `ui:enableMarkdownInDescription`, `ui:field`, `classNames` and `style`, so a template cannot ask for RJSF's Markdown renderer, a custom component or injected attributes. An invalid message's plain text and its warning are text. The e2e test "a hostile client's message…" confirms markup stays text in the browser. Nothing in a card is a link.

### I4: identity and permission

The sender's role is resolved from the occupant JID's local part on the game's domain (`SessionStore.toSender`, §3 rule 3), never from the body. `templatesFor` reads the force's umpire flag and the role's observer flag from server documents that only the admin publishes. Observers have no voice (R1), so the observer rule in `templatesFor` is display only.

### I5: size (T-R2)

Values are capped at 8,000 characters each and 100 fields; the composer refuses a stanza over 64 KiB (PLY-53); the server's `max_stanza_size` is 262,144 bytes, so a modified client's body is bounded before any client parses it. A template document must fit one PubSub item. The image picker, the main T-R2 risk, is not built (A5).

### I6: CSP

`@cfworker/json-schema` interprets schemas; `csp.test.ts` runs the validator, the RJSF adapter and the message schemas with `eval` and `new Function` replaced by throwing functions. The form is imported from `@rjsf/core/lib/components/Form.js`, never the package root, which imports `@rjsf/validator-ajv8`; lint forbids both. The e2e specs for the composer and the editor fail on any CSP violation in the built app. The CSP is unchanged. One robustness note: a validator is compiled outside the `try` that guards validation, so a schema that made the library throw on compile would break the room's render rather than mark one message. The profile makes such a schema unlikely, and only the admin can publish one.

### I7: libraries

- `fast-uri` 4.2.3 (BSD-3-Clause), resolved by `@rjsf/utils` 6.11.0, was published on 19 October 2026 at 22:51 UTC: one day short of the 14-day rule when adopted on 1 November, and 14 days old from 22:51 UTC on 2 November. It is a security release (4.2.2 is vulnerable). Nothing in our code resolves URIs at run time (templates hold no `$ref`). Once that time has passed, the rule is met and the owner's decision is moot.
- `markdown-to-jsx` 9.10.3 is bundled as a dependency of `@rjsf/core` but never rendered (I3).

## What was checked, and how

- Read: `packages/schemas/src/template.ts` (the profile, `unsafePattern`, the document, config and body schemas), `packages/templates/src/*` (validator, permissions, check, RJSF adapter), `packages/domain/src/store.ts` (reading templates and configs, `checkTemplate`, identity), `packages/player-ui/src/templates/*` and `chat/chat-composer.tsx` (form, card, pickers), `packages/admin-ops/src/target.ts` and `publish/plan.ts` (node access, locks, removal), and the admin editor's template and room sections.
- Probed: H1 with timings on the real validator; SC-10 on the mock and ejabberd for permission drift (a copy replaces a locked template; the old message keeps its card with the not-permitted warning, and a deleted role in a picker shows "(deleted)").
- Not probed here: Firefox and WebKit (not installed in this environment); a screen reader.
