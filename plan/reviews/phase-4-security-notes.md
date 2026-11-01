# Phase 4 security review notes (internal)

For the tech-lead review of Annex A (message templates). Not for the public site (DOC-2). Earlier phases' notes are in `phase-2-security-notes.md` and `phase-3-security-notes.md`; the v1 review is `v1-security-review.md`. Phase 4 builds on the provisional answers in `plan/decisions/annex-a-b-implementation.md` ("Provisional answers for Phase 4").

## WP 4.1, the template model

### What the server enforces, and what it does not (T-R1)

- **Enforced by ejabberd:** who reads and who writes the `templates` node (whitelist, every role `member`, the admin owner and only publisher; contract T01 on both backends), room membership and voice (unchanged). A player cannot publish, overwrite or retract a template, and an anonymous session cannot read one.
- **Not enforced (D2), advisory in every client:** which templates a role may use in a room, whether free text is allowed, and whether a message's values fit its template. A modified client can post any body its voice allows. Every receiving client runs the same check (`@wrx/templates` `checkTemplatedMessage`, through `SessionStore.checkTemplate`), and the sending client runs it first (`sendTemplateMessage`), so an unmodified client never sends what receivers refuse.
- **Identity** still comes from the occupant JID only (§3 rule 3): the check resolves the sender's role from `Sender.loginName` (the stanza), never from the body. Picker values (force and role GUIDs) are display data, never identity or permission (TPL-8).

### The node

- `templates` is a singleton leaf (provisional answer 1), `max_items` 500 (`TEMPLATE_LIMITS.templates`, accepted by ejabberd 26.09: contract T01 creates it so), one item per template, item id the template GUID. A reader ignores an item whose id is not its document's id (`SessionStore.templateList`, `publishedDesign`), as `retired` does.
- `RESERVED_NODE_NAMES` is now empty and `RESERVED_NODE_PREFIXES` is `['templates']`: `templates` is a managed singleton, and nothing below it (`templates:…`) is ever listed, created, changed or deleted by the tooling (`isGameNodeName`, `AdminOps.checkNode`) or read by the client (`nodeSpec`). Tests: `nodes.test.ts`, `plan.test.ts` "never plans anything below `templates`", `execute.test.ts` "refuses to retract below `templates`", the admin-ops scenario on both backends.
- Templates are not confidential between forces (provisional answer 5): every role reads every template, so a template's name and fields must not reveal one force's plans to another. If the owner answers otherwise, templates move to per-force nodes.

### Publish, locks and removal

- **Order.** Templates are documents of the documents group, ranked before rooms, so a client that reads a room's config finds its templates; templates the design dropped are retracted in the removals group, after the rooms' documents stop offering them (`plan.ts` `DOCUMENT_ORDER`, `retractStep`).
- **Lock on publish (provisional answer 2).** The planner, before building the target, sets `lockedAt` on every design template a chat room's config names (`withTemplateLocks`): the server's lock if it has one, else the draft's, else the design's export time (the planner keeps no clock). A lock is never removed. The mock seed locks the same way, as a publish would leave it.
- **Refusal** (`templateLockErrors`, a planning error like ADM-5's): a design that changes the `schema` of a template the server holds locked (`template-locked-changed`, remedy: copy to a new template). Dropping a locked template is not refused (a new design replacing a published game must be publishable, as it can delete roles and destroy rooms); it is a confirmed removal, below. A plan with errors has no steps and the executor refuses it. The audit refuses the same designs before comparing (`runAudit`), as V2 required for login names, since its repair would publish the change the planner refuses. Locks are read from the server, so a lock set by another browser's publish holds even when the draft does not know it; the publish screen merges the server's locks into the draft (`mergeTemplateLocks`).
- **What a lock covers:** the schema only. The name, description and UI schema of a locked template may change; old cards then show the new name and field order. Validation depends on the schema alone.
- **Retraction** (`AdminOps.retractItem`): owner retract, then a read-back that the item is gone; already gone is success. Planned for every template (or unreadable item) on the server that the design does not have, with a `template-removed` warning saying whether it is locked (if so, the messages that used it show as plain text from then on). Every retraction needs its confirmation (`stepConfirmation`: `template:<id>`, worked out from the action, F9), in the apply dialog and in the audit's repair.

### The validator and the CSP (F7)

- `@cfworker/json-schema` 4.1.1 interprets schemas and never generates code; a test proves the validator, the RJSF adapter and the message schemas work with `eval` and `new Function` replaced by functions that throw, and that the library's shipped source holds neither (`csp.test.ts`). `@rjsf/validator-ajv8` is not used. The CSP is unchanged.
- Values are validated against a copy with no prototype (`plainValues`): the library tests fields with `in`, which on a plain object would see `Object.prototype`, so a required field named `toString` would pass unfilled, and one present would throw. Test: "does not see Object.prototype as fields".
- `__proto__`, `constructor` and `prototype` cannot be field names (profile and message body).

### The profile against hostile values

A modified client controls every value, and an admin-written schema runs on all of them in every receiver:

- Text fields need `maxLength` (at most 8,000, a chat message's limit); the message body caps every string at 8,000 and the stanza at 64 KiB (PLY-53), so a value is bounded before the schema sees it.
- `pattern` must pass `unsafePattern`: at most 200 characters, valid with the `u` flag, no backreferences or lookaround, no quantifier on a group except `?`, and at most three variable quantifiers; a field with a pattern keeps `maxLength` at 200 or less. This is stricter than a star-height check, which passes `(a|a)*`. The worst accepted case is polynomial with a small degree on 200 characters (test "keeps the worst accepted pattern fast").
- No nesting: fields are scalars; conditions (`dependencies`, `if`/`then`/`else`, `allOf` of conditions) are one level deep and name declared fields only; at most 100 fields, 500 options a drop-down, 100 conditions. The checker never walks an unbounded structure (test "refuses deep nesting without walking it").
- `$ref`, `$defs`, arrays, objects, `patternProperties` and every other keyword are refused, so no schema reaches a remote reference or recursion.
- The UI schema is restricted too: field order, a widget from a fixed list that fits the field, short hints, textarea rows. `ui:field`, `classNames`, `style` and other RJSF options are refused, so a template cannot ask for a custom component or inject attributes.
- A template document must fit one PubSub item (checked in the schema, and by the transport before sending).

### The receiver's check (TPL-6, provisional answer 3)

In order: the template is known (else **invalid**, shown as plain text with a warning); the values fit its schema (else **invalid**); force and role picker values are GUIDs of a known or deleted force or role of the right kind (else **invalid**); the sender may use the template in this room under today's config (else **not-permitted**, shown as a card with a warning, since the config may have changed after sending). A picker's room scope and force filter are not checked on receipt: they drift with participants and roles.

### Permissions (provisional answer 4)

`templatesFor`: the admin and White Force roles that are not observers may use every template the room's entries name; observers none (the White Force's included); any other role its force's entry plus its own role entry (a role entry adds, never takes away); an unknown user, or a role of an unknown force, none; an entry naming an unknown force or role grants nothing. Free text follows the room's config for everyone, the admin included (`mayUseFreeText`); the store refuses free text in a templates-only room before sending, and nothing on receipt can tell a modified client's free text from an older message.

### Data

- Design files stay at version 2: `templates` defaults to `[]`, so older files import unchanged. Deleting a force or role in the draft drops its template entries with its participant entries; `checkDesign` refuses entries naming unknown forces, roles or templates, a template GUID another entity has, and more than 500 templates.
- The mock's browser database is not migrated: a stored state from before WP 4.1 has no `templates` node (its store sees none) until the demo is reset.

### Residual risks for the review

- **Advisory rules (T-R1).** As above: a modified client can post a template it may not use, or free text in a templates-only room. Receivers mark the first; nobody can mark the second.
- **Lock granularity.** Lock-on-publish is stricter than "used in a message" (TD6) but cannot miss a use. A template offered once and never used is still locked for good, short of a reset.
- **Retracting is irreversible.** Removing a locked template turns its messages into plain text with a warning, for good; it is confirmed one by one, and the warning says so. A template item that does not parse is reported as unlocked; it cannot render as a card anyway.
- **Library age.** `@rjsf/utils` 6.11.0 resolves `fast-uri` 4.2.3, released 13 days before adoption (the rule is 14). 4.2.3 is a security release (four advisories fixed); 4.2.2 is older but vulnerable. Kept, and recorded for the gate. `@rjsf/utils` is imported only by the RJSF adapter entry (`@wrx/templates/rjsf`); nothing in WP 4.1 resolves URIs at run time (templates hold no `$ref`).

## WP 4.2, the composer and the card

### The form under the CSP (F7)

- RJSF's `Form` (`@rjsf/core` 6.11.0) renders the template, validated by `createTemplateFormValidator` (the receiver's interpreter); `@rjsf/validator-ajv8` is not installed. `@rjsf/core`'s root module imports it (for `getTestRegistry`, a packaging slip in 6.11.0), so the form is imported from `@rjsf/core/lib/components/Form.js`; ESLint refuses `@rjsf/validator-ajv8` and the `@rjsf/core` root everywhere (`eslint.config.js`). The built form chunk holds no `new Function` or `eval`; the e2e spec `templates.spec.ts` sends every field type in the built app under its CSP meta tag and fails on any CSP violation or page error.
- The form is a lazily loaded chunk (`templates/lazy.tsx`, about 250 kB): a room without templates loads no RJSF code. Its styles load with the chat panel, so a popout has them.

### Plain text only (PLY-14)

- Template names, descriptions, field titles, `ui:title`, `ui:description`, `ui:help`, placeholders and option titles are React text in our own RJSF templates and widgets (`templates/theme.tsx`); RJSF's Markdown descriptions (`markdown-to-jsx`, `RichDescription`) are never rendered, and the profile refuses `ui:enableMarkdownInDescription` and every other UI option it does not list. Card values are React text (`TemplateCard`). Tests: a hostile title and description render as text (unit), and a hostile client's markup stays text in the browser (e2e).
- `markdown-to-jsx` is still bundled as a dependency of `@rjsf/core` (held at 9.10.3 by a workspace override: 9.10.4 is younger than 14 days).

### Received messages

- Every templated message is checked on render (`SessionStore.checkTemplate`, re-run when templates, the room's config or the documents change). `valid`: the card. `not-permitted`: the card with a warning (provisional answer 3). `invalid` (unknown template, schema, picker): the one-line plain text (`templatePlainText`) with a warning. A card shows only fields the template declares (the check refuses undeclared ones) in the form's order; a picker's GUID shows the current name, or the deleted entity's last name marked "(deleted)" (TPL-8, TPL-9). Nothing in a card is a link.
- The warning is static text from the check, naming at most the template; it does not quote values.

### Sending

- The composer runs RJSF's validation (the same interpreter) before the store's `sendTemplateMessage`, which runs the receiver's full check and the stanza cap again (T-R1 unchanged: all of it is advisory). The stanza size is shown and checked before sending (PLY-53).
- A refused templated message's values are kept on the room in the store (`RoomView.unsentTemplate`, like `unsent` for text), so a re-mounted panel shows them again; they are dropped on the next successful templated send. They live in memory only, like unsent text.
- Unticked yes/no fields are sent as `false`, not left out.
- Pickers offer live forces and roles (`x-wrx-scope: room` narrows to the room's effective participants, `x-wrx-force` to one force); a value the form already holds that the list no longer offers is kept as an option, labelled by name or "(deleted)", so the form never hides what it would send.

## WP 4.3, the template editor

- **Only profile schemas leave the builder.** The builder writes a fixed set of shapes (text with `maxLength`, numbers, yes/no, dates with `maxLength`, `enum` or `oneOf` of `{const, title}`, linked drop-downs as a `dependencies` `oneOf`, pickers with the WRX keywords) and `checkTemplateProfile` still runs on every result; it reads back only what it would write (`readTemplate` compares the round trip), so it never silently drops or rewrites a keyword. The raw editor accepts any JSON object into the draft, so a half-fixed template survives a reload; the draft is then unpublishable (`validateDraft` reports each profile issue) and the planner and schema refuse it as before. The stored draft's template check is structural only (`storage.ts`), like its other lenient fields.
- **CSP (F7).** The preview uses `createTemplateFormValidator()` only. `@rjsf/validator-ajv8` is not installed; lint forbids it and `@rjsf/core`'s root entry, which imports it. CodeMirror 6 needs no eval and no workers; it injects its styles in a `<style>` element, which `style-src 'self' 'unsafe-inline'` already allows. The built bundle holds no `new Function` (checked by grep), and `apps/web/e2e/template-editor.spec.ts` opens the builder, raw editor and preview under the build's CSP with no `securitypolicyviolation`. The CSP is unchanged.
- **Rendering.** Titles, descriptions, options and values are rendered as React text. The preview never sets `ui:enableMarkdownInDescription` (the profile refuses it in stored UI schemas); the only UI options the preview adds are its own picker widget and a hidden submit button, never stored.
- **Locks.** Read only in the UI and refused by `updateTemplate` for the schema; the planner's `template-locked-changed` stays the real guard (a draft that has not yet planned against a server may show a template unlocked that another browser's publish locked).
