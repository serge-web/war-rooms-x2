# Technical details

## Stack

| Area | Choice |
| --- | --- |
| Language | TypeScript in strict mode everywhere; `any` and unchecked casts of network data are lint errors |
| Schemas | zod, with types inferred from the schemas |
| Client | React 19, built with Vite as a static bundle |
| Protocol | XMPP: multi-user chat (XEP-0045), publish-subscribe (XEP-0060), message archive (XEP-0313) with result paging (XEP-0059), and ad-hoc admin commands (XEP-0133) |
| Server | ejabberd 26.09 |
| Tests | Vitest for units, Playwright for end-to-end, and one transport contract suite run against both the mock and the real server |
| Site | VitePress, with Mermaid bundled |
| Repo | A pnpm monorepo: `packages/schemas`, `apps/web`, `site`, `tools` |

## How game data maps to XMPP

Every part of a game maps to one native XMPP construct, plus a JSON document in PubSub where it needs configuration. The [data dictionary](./data-dictionary) lists every field.

| Entity | XMPP construct | Document |
| --- | --- | --- |
| Wargame | — | `game-setup`: name, description, briefing, theme, room-type defaults, design version |
| Force | Room memberships of its roles | `forces:<forceId>`: name, colour, icon, umpire flag |
| Role | One user account | `roles:<roleId>`: name, force, observer flag |
| Room | One chat room | `rooms:<roomId>`: name, room type, participants, type-specific settings |
| Message | A chat message | Body is JSON: `{type, schemaVersion, content}` |
| History | The server's message archive | — |
| Announcement | — | One item per announcement in `announcements` |
| Objectives | — | `objectives:<forceId>`, Markdown |

Every document carries `schemaVersion`. Clients validate each document as they read it, migrate older versions, and log and ignore anything invalid rather than failing.

## Hosting

The client is one static build that loads every asset by relative URL, so it runs under any path. It supports three ways of hosting:

1. served by a reverse proxy on the same origin as the XMPP WebSocket endpoint;
2. from a separate static host, with a configured proxy;
3. as plain files, with the mock backend only. The previews and the live demo on this site use this mode.

Server addresses are runtime configuration, never build-time constants, and no secret is ever in the bundle or the repository.

## Previews and the live demo

Every pull request from this repository deploys the whole site, with a fully interactive build of the app on the mock backend, to `pr/<number>/`. A bot comment on the pull request links to it, and is updated on each push. When a pull request merges its preview is kept; when one closes without merging its preview is removed. Every push to `main` deploys the <DemoLink>live demo</DemoLink> to `demo/` and refreshes this site.

All deploys share one queue on the `gh-pages` branch, so parallel pull requests can't overwrite each other, and a deploy that loses a race retries on top of the newer state. CI reports the site's size on each deploy and warns at 70% of the GitHub Pages limit.

Blog posts that show the app embed a **frozen snapshot**: a build of the exact commit the post describes, kept at `snapshots/<post>/`.

### Try the demo

<AppDemo :height="360" />

## Quality gates

Every pull request runs type checking, lint, formatting, unit tests, a traceability check that every requirement belongs to a work package, a check that every Mermaid diagram parses, and Playwright end-to-end tests. The site build adds a scan for secrets and real-server addresses, a review scan of the published text, and the size report.
