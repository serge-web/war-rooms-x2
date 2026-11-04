# WP 4.3 — Template editor and room template config (Annex A, A3)

**SRD ids:** TD2, TD4, TD5, TD6, TPL-2, TPL-4, TPL-7, ADM-9, NFR-14 · **Depends on:** 4.1 (in parallel with 4.2) · **Status:** done

## Goal

The admin designs templates with a drag-and-drop builder or raw JSON Schema, previews them live, and chooses per room which templates each force or role may use and whether free text is allowed.

## Acceptance

- **Templates section** in the design editor: list, add, rename, delete (refused while a room uses it), copy. Locked templates (published in a room) open read only with "Copy to new template" (TPL-4).
- **Builder (TD5, TPL-7):** a field palette (text, long text, number, slider, yes/no, date, date-time, drop-down, linked drop-downs, force picker, role picker) on dnd-kit, with keyboard sorting like the forces and rooms lists; per-field settings (label, required, limits, options, picker scope and filter). It writes WRX-profile JSON Schema plus UI schema and reads them back.
- **Raw editor:** CodeMirror 6 with JSON, on the same template; profile errors shown in place. A schema the builder cannot show opens raw only, with a notice. Switching between builder and raw keeps the schema.
- **Live preview** with the 4.2 RJSF theme (shared component, or a placeholder renderer if 4.2 has not landed; agree the seam with 4.2).
- **Room config (TD3, TD4, TPL-2):** per room, "Free text allowed", and templates per force or role entry, beside the participants editor; the access matrix (ADM-9) gains each role's templates per room.
- **Publish:** the plan shows template changes and locks; export and import carry templates.
- **Tests:** admin-ui e2e: build a template with every field type, edit raw, preview, assign to a force in a room, publish, and see it locked; keyboard-only reorder; axe clean. Tagged screenshots of the builder, raw editor and room config.

## Notes (done)

- **Preview seam.** The preview renders with `@rjsf/core`'s own theme through `TemplatePreview` (`packages/admin-ui/src/templates/TemplatePreview.tsx`), validated by `createTemplateFormValidator()`. `AdminApp` takes `templatePreview?: TemplatePreviewSlot` (`{template, design}`), so WP 4.4 can pass WP 4.2's themed form without touching the editor.
- **Builder round trip.** The builder shows a template only if writing its fields back gives the same schema and UI schema (key order, `required` order and `ui:order` versus declaration order aside); otherwise it opens raw only. The three demo templates open in the builder.
- **Locks.** A locked template's fields are read only in the builder and the raw editor; name and description stay editable. The draft refuses a schema change to a locked template (`updateTemplate`). The mock's admin draft starts with the seed's locks; on a real server a draft learns locks when it plans or publishes (WP 4.1's `mergeTemplateLocks`).
- **Libraries** (MIT or Apache-2.0, each at least 14 days old on Nov 1, 2026): `@rjsf/core` 6.11.0; `@codemirror/state` 6.7.6, `view` 6.43.14 (6.43.15 too new), `commands` 6.11.1, `language` 6.13.1, `lang-json` 6.0.2, `lint` 6.9.7; `@lezer/common` 1.5.3, `@lezer/lr` 1.4.11 and `markdown-to-jsx` 9.10.3 pinned directly so their newer releases are not resolved. `@rjsf/core`'s root entry imports `@rjsf/validator-ajv8` (a test helper); lint forbids that entry and Ajv, and the preview imports `@rjsf/core/lib/components/Form.js`.
