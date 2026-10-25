# WP 2.4 — Player shell

**SRD ids:** PLY-1–3, PLY-27–32, PLY-46–48, PLY-50–52, NFR-8–9 · **Depends on:** 1.6 · **Status:** done

## Goal

The app's frame: backend choice, the welcome page, login, session lifecycle and empty states. Also the shared UI package and Storybook.

## Acceptance

- **`apps/web`:**
  - routes for welcome/login, the player client, the admin backend (handed to 2.2) and the multi-client view (handed to 2.9);
  - runtime config for real-server endpoints, from a `config.json` next to `index.html`, never a build constant (NFR-9). It must work in all three hosting modes (NFR-8);
  - the backend choice, real or mock, with the mock selectable offline (PLY-20). The mock uses `connectMockTransport` from `@wrx/mock-host` and shows its notices;
  - the backend in use is shown at all times (PLY-1).
- **Welcome page:**
  - `game-setup` and the game theme's assets are fetched anonymously (D20, PLY-27);
  - layout: logo, name, description, then the Markdown briefing in a fixed-height scrolling box, then the login form (PLY-46, PLY-47);
  - falls back to the default theme, and still allows login (PLY-27, PLY-32).
- **Session lifecycle:**
  - login with role id and password (PLY-1);
  - a reconnecting indicator (PLY-2);
  - forced logout with an explanation on `session-ended`, `account-removed` or `deleted` (PLY-29, PLY-50);
  - logout releases everything (PLY-3).
- **Empty states:** no published game, and a role with no rooms (PLY-32).
- **`packages/ui`:** buttons, fields, dialog, toast, Markdown view (marked plus DOMPurify) and the theme-scope wrapper, all styled only by the `--wrx-*` properties. Storybook with stories for each (NFR-18).
- `packages/player-ui` with the shell. The workspace is a slot that 2.5 fills; the out-of-game column is a slot that 2.7 fills.
- Playwright scenarios against the mock (`@screenshot`), and a login test against ejabberd if the stack is available in CI.

## Owns

`apps/web/`, `packages/ui/`, the shell parts of `packages/player-ui/`.

## Consumes

`@wrx/hooks`, `@wrx/domain`, `@wrx/mock-host`, `@wrx/transport-xmpp`.
