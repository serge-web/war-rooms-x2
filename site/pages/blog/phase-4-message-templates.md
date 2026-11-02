---
title: 'Phase 4: message templates'
date: 2026-11-02
phase: 4
status: gate
---

# Phase 4: message templates

v1 rooms carry free text. Phase 4 adds structured messages: the admin designs forms, decides which forces and roles may use each one in each room, and players send them from the room's composer. Everyone in the room sees each one as a card. The [message templates page](../templates) describes the feature in full; this post is the summary at the gate.

There were no work-in-progress posts during Phase 4, so this post is the whole story of the phase.

## What changed in Phase 4

- **Templates in the design.** A new Templates section in the admin's editor. The admin builds a form by dragging fields from a palette, or edits its JSON Schema directly; both work on the same template. A live preview shows the form exactly as players see it, with the same checks.
- **Every field the specification asks for, bar two.** Text and long text, numbers and sliders, yes/no, dates and times, drop-downs, linked drop-downs where one choice sets the next list's options, and force and role pickers. A picker stores the force's or role's id, so a card always shows the current name, and a deleted one's last name marked "(deleted)". Image and asset pickers are not built yet.
- **Rooms decide.** Each room says whether free text is allowed, and which templates each force or role may use there, so two forces in one room can have different forms. The access table shows the result for every role before anything is published.
- **Locking.** Once a published room has offered a template, its fields are fixed, so messages already sent keep their meaning. To change one, the admin copies it and offers the copy; old messages keep the template they were sent with.
- **The composer and the card.** A Message type drop-down picks free text or a template, the form checks every field before sending, and unsent values are kept like unsent text. Cards list each field's label and value in plain text. Every client checks every templated message against its template: one that does not fit is shown as plain text with a warning, and one whose template the room no longer offers to its sender is still a card, with a note.

## How it was checked

A new user scenario, SC-10, runs on the in-browser mock and on a real ejabberd server. The admin builds a template, offers it to one force in a room that takes templates only, and publishes. A player of that force sends it, and a player of the other force sees the card but has nothing to send. The admin then copies the locked template, changes the copy, deletes a role the first message named, and publishes again. The old message still shows with its own template and the deleted role's name. Writing it found one problem, in the room settings: unticking a force's last template there hid that force's row. It is fixed.

A room of 2,000 templated messages, using every field type, is measured on every run. It opens in about a tenth of a second and scrolls as smoothly as a plain chat room. Checking a message against its template takes about two hundredths of a millisecond.

Every new screen passes the automated WCAG 2.2 AA checks, and every field type can be filled and sent with the keyboard alone. The browser checks on Safari's engine found the composer's buttons covering part of a field at rest; the buttons now sit below the form.

Before this gate, a reviewer read the template code again, independently of the people who wrote it. It found one problem rated high: a message with an over-long value could keep every other client in the room busy for minutes. It is fixed and covered by a test; its rating and fix await the product owner's confirmation. Everything else is either fixed with a test or recorded with its reason.

The plan for Phase 4 ran as drawn: four work packages, none added or split.

## What is still open

Phase 4 was built on recommended answers to questions the product owner deferred. These are the ones a user sees, for the owner to confirm or change:

- **When a template locks.** A template locks when a published room first offers it, not when a message first uses it, because which templates have been used cannot be seen reliably. A template offered once and never used is locked too.
- **Removing a locked template.** Allowed, after a confirmation for each one. Messages that used it then show as plain text, with every value, from then on.
- **Templates no longer offered.** A message whose template the room no longer offers its sender shows as a card with a note, not as plain text as the specification first said, so changing a room's settings does not rewrite its history.
- **Who gets which templates.** A role's own templates add to its force's. The umpire and White Force roles who are not observers may use every template a room offers; observers none.
- **Templates are not private to a force.** Every role can read every template, so a template's name and fields should not give away one force's plans.
- **Unticked yes/no fields.** An unticked box is sent, and shown, as "No", not left out.
- **The form's controls.** The template form uses the browser's own drop-downs and date pickers, styled with the app's colours, rather than the app's own drop-down component.
- **Image and asset pickers.** Not built. They wait for the decision on how images are stored, and for the force assets of the map channel.

One is already decided: a lock fixes a template's fields, their labels and order, and its name, so old cards always read as they did when sent. Only its description can still change.

## Next

Gate G4 is the product owner's review of this phase, including the answers above. After it, the remaining template work is the image and asset pickers, which follow the force assets and the map channel.
