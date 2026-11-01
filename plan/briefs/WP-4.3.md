# WP 4.3 — Template editor and room template config (Annex A, A3)

**SRD ids:** TD2, TD4, TD5, TD6, TPL-2, TPL-4, TPL-7, ADM-9, NFR-14 · **Depends on:** 4.1 (in parallel with 4.2) · **Status:** todo

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
