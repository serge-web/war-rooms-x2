---
title: 'Phase 3: v1, ready for its first real install'
date: 2026-11-01
phase: 3
status: gate
---

# Phase 3: v1, ready for its first real install

Phase 2 made a game you could design, publish and play. Phase 3 set out to prove it: every user scenario run end to end on both backends, performance and accessibility measured, more browsers tested, a deployment that installs without the internet, and a final review. All of that is done. One step is left before the release: installing it on the real hardware, which is with the product owner. Until then, v1 is a release candidate.

There were no work-in-progress posts during Phase 3, so this post is the whole story of the phase.

## What changed in Phase 3

- **The user scenarios, on both backends.** Nine scenarios, from designing and publishing a game to two people sharing one role, now run as browser tests on the in-browser mock and, wherever a server is involved, on a real ejabberd server. What they found is fixed, and each fix has a test.
- **Performance at scale.** A generated game of 50 roles, 30 rooms and a 10,000-message room is measured on every run. Opening the big room takes well under a second, typing never lags, and a message reaches four open panes in about a twentieth of a second.
- **Accessibility.** Every screen is checked against WCAG 2.2 AA with an automated checker, and the main tasks are tested with the keyboard alone. The gaps it found, such as unread counts that screen readers could not hear, are fixed.
- **Browsers.** The tests now also run on Firefox and on Safari's engine. Chrome and Edge are fully supported; Firefox and Safari are best effort, and the two problems still open are listed in the release notes.
- **A narrow-window layout.** When space is short, the out-of-game column becomes a tab of its own instead of squeezing the rooms.
- **Ids that never change.** Forces, roles and rooms are now identified by GUIDs, and each role has a separate login name. Renaming anything is safe, and a deleted role's old messages still show its name, marked as deleted. A role's login name is fixed once it is published: the server cannot rename an account, so publishing is refused, with the reason, rather than quietly making a new account.
- **Objectives by the umpire only.** Only the admin, as umpire, writes a force's objectives. Every White Force role reads all of them.
- **The reference deployment.** One container serves the client and the server on one secure address. It installs from a single bundle on a machine with no internet access, works with the organisation's certificate authority or a small one made for the exercise, and backs up and restores while it runs. The [deployment page](../deployment) has the outline.

## How it was checked

Every change runs the unit tests, the browser tests on the mock, and the contract, admin, publishing, audit and deployment suites against a real ejabberd server. The install itself is tested inside a container with its network switched off, and then the whole contract suite runs against that installation.

Before this gate, a reviewer read the security-relevant code again, independently of the people who wrote it. It found that a player's own role could only be found by listing the server's documents, so a server that refused the listing left the player with no rooms; that is fixed, and the client now finds its role directly. It also found ways an imported design could rename or reuse a published login name; publishing and the audit now refuse both. Nothing it found was rated high or critical, and each finding is either fixed with a test or recorded with its reason.

## What is still open

- **The real-hardware install.** The deployment has only been installed in containers. The first install on the real host is with the product owner, with a checklist in the operator's guide. This post will say when it is done.
- **Certificates.** Whether the customer's own certificate authority issues the server's certificate, or a small one made for the exercise does, is still to be decided. The scripts support both.
- **Moving an earlier game.** A server published by an earlier build is not upgraded in place: export the design, import it, reset the server and publish. No game has run for real yet, so nothing is lost today.

## Next

After the real-hardware check, v1 is released, with the release notes in the repository (`RELEASE-NOTES.md`) as its description. The next features are already specified: structured form rooms with message templates, and maps with force assets.
