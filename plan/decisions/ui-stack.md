# UI stack and Phase 2 package layout (D24)

Decided at the start of Phase 2, so the three lanes build on the same parts.

## Libraries

| Need | Choice | Why |
| --- | --- | --- |
| Accessible primitives (dialogs, menus, tabs, popovers, toasts) | Radix UI Primitives | Unstyled, so theming stays in CSS custom properties (PLY-26). WAI-ARIA patterns built in (NFR-14). First-class TypeScript. Bundles offline (NFR-7) |
| Drag and drop with keyboard alternatives | dnd-kit | Keyboard sensor and screen-reader announcements built in (ADM-8, NFR-14) |
| Dockable workspace | FlexLayout (`flexlayout-react`) | WP 0.2 (`layout-library.md`). Wrapped in one workspace module (ARC-9) |
| Markdown (briefing, objectives) | `marked`, sanitised with DOMPurify | Small, typed. Every rendered HTML string is sanitised; message text is never Markdown (PLY-14) |
| SVG sanitising on upload | DOMPurify, SVG profile | Same library as Markdown; SVG is still shown only via `<img>` (§3 rule 12) |
| Colour picking | Native `<input type="color">` plus a hex field | No dependency; accessible |
| Component catalogue | Storybook | NFR-18, deferred from 0.5 to 2.4 |

Pin every version to a release at least 14 days old. A lane that needs another library records it in its report, and the gate summary lists it.

## Packages

| Package | Holds | First owner |
| --- | --- | --- |
| `packages/admin-ops` | Framework-free admin operations over a `Session`: provisioning, the rules R-A to R-F, the observer-password vault (ADM-35–40) | 2.1 |
| `packages/theme` | Token resolution and inheritance, CSS custom properties, contrast checks, asset checks and SVG sanitising | 2.8 (2.2 and 2.4 use the token names below before it lands) |
| `packages/ui` | Shared presentational components (buttons, fields, dialogs, Markdown view) over Radix, styled only by tokens. Storybook lives here | 2.4 |
| `packages/admin-ui` | The admin backend's screens: design editor, access matrix, themes, publish, audit | 2.2, then 2.3, 2.8 and 2.10 |
| `packages/player-ui` | The player client: welcome page, login, shell, workspace, chat panel, out-of-game column | 2.4, then 2.5, 2.6 and 2.7 |
| `apps/web` | Composition only: routes, backend choice and runtime config | 2.4; later WPs add only their route |

Presentational components are split from data hooks (NFR-18, the WRX `*Core` pattern). A `FooCore` takes plain props; `Foo` wires it to `@wrx/hooks`.

## CSS custom properties

Every lane styles with these names, so 2.8 can theme everything without touching the lanes' CSS:

```
--wrx-primary  --wrx-secondary  --wrx-background  --wrx-surface  --wrx-text
--wrx-font-family  --wrx-border  --wrx-muted  --wrx-focus  --wrx-danger
```

The first five map to the theme tokens (§3 rule 10). The rest derive from them in `packages/theme`. A themed panel sets the properties on its own root element only, so one panel's theme cannot leak into another (PLY-26).
