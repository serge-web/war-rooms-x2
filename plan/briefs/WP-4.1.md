# WP 4.1 — Template model (Annex A, A1)

**SRD ids:** TD1, TD2, TD6, TPL-1, TPL-2, TPL-4, TPL-6 (validator), TPL-8, TPL-9, T-R1, T-R2 · **Depends on:** Phase 3 (G3) · **Blocks:** 4.2, 4.3 · **Status:** done · **Security review required**

## Goal

Everything the template composer and editor build on: the schemas, the `templates` node in publish, audit, reset and the mock, the room config that says which templates each force or role may use, and one validator shared by sender and receiver that works under the client's CSP. Design: `plan/decisions/annex-a-b-implementation.md`, section 2, with the provisional answers recorded there.

## Acceptance

- **Libraries:** re-check versions, licences and the 14-day rule on npm before adopting (`@rjsf/utils`, `@cfworker/json-schema`). No `@rjsf/validator-ajv8`, nothing needing `'unsafe-eval'`; the CSP is unchanged.
- **Schemas (`@wrx/schemas`, data dictionary regenerated):**
  - Template document `{schemaVersion, id (GUID), name, description?, schema, uiSchema?, createdAt, lockedAt?}`, under the 250,000-byte item limit.
  - The **WRX template profile**: a restricted JSON Schema 2020-12 subset (object of named fields; string with required `maxLength`, number/integer, boolean, enum with `oneOf` titles, `format: date | date-time`, `dependencies`/`if-then` for linked drop-downs) plus WRX keywords (`x-wrx-picker: force | role`, `x-wrx-scope: game | room`, `x-wrx-force` filter). `pattern` only if it passes a safe-regex check. A profile checker with clear error messages; anything outside the profile is refused.
  - `chat` room config version 2: `{freeText, templates: [{kind: force | role, id, templateIds}]}`, with version 1 configs read as `freeText: true`, no templates.
  - Message body `{type: 'template', schemaVersion: 1, content: {templateId, values}}`, within the 64 KiB cap (PLY-53).
- **Validator adapter:** an RJSF `ValidatorType` over `@cfworker/json-schema` (or the fallback in the design record), in a package both the composer and receiver use. A function `checkTemplatedMessage(message, template, roomConfig, sender, entities)` returning valid, invalid (schema or unknown template: show as plain text with a warning, TPL-6) or not-permitted (card with a warning, provisional answer 3). Force and role picker values must be known or retired GUIDs. Unit tests with tricky and hostile schemas and values (long strings, backtracking patterns, deep nesting, wrong types), and a test that it runs with `new Function` and `eval` unavailable.
- **Permissions:** effective templates for a role in a room follow §3 rule 4's entries; a role entry adds to its force's entry (provisional 4); the admin and White Force non-observers may use every template configured in the room; observers none. Unit tests per case.
- **Server:** a singleton `templates` leaf (provisional 1), every game user reads, only the admin publishes, one item per template, item id its GUID. `targetState`, the planner, executor, audit and repair, and reset handle it; `RESERVED_NODE_NAMES` moves `templates` from reserved to managed without exposing anything else under it. Lock on publish (provisional 2): a publish that makes a template available in a published room sets `lockedAt`; the planner refuses a design that changes a locked template's schema, with the remedy "copy to a new template".
- **Mock:** the same node and rules; contract tests on the mock and ejabberd (read by players, publish refused to non-admin, anonymous refused, size limit).
- **Store and hooks:** the session store loads and live-updates templates and room config v2; `useRoomTemplates(roomId)` gives the templates the current role may use and whether free text is allowed.
- **Seed:** the demo game gains two or three templates (for example a situation report with a force picker, a slider and a date) in one room, with free text off in that room.
- **Gates:** `pnpm check`, build plus `check:bundle`, every e2e suite (`e2e`, `e2e:mock-host`, `e2e:admin-ui`, `e2e:theme`), site checks, screenshots `--repeat`, and on ejabberd the contract, admin-ops, publish, audit and deployment suites.

## Notes

Security notes for the review go in a new `plan/reviews/phase-4-security-notes.md` (internal). No UI beyond what the seed needs: the composer is 4.2, the editor 4.3.
