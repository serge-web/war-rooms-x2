# Site

The public site (SRD §13): background, architecture, technical details, the data dictionary, the blog and the PR index, with the app embedded at `app/`. Built with VitePress.

```sh
pnpm site:build      # the app, then the site, into site/dist (base path /)
pnpm site:serve      # serve site/dist at http://localhost:4174/
pnpm --filter @wrx/site dev    # live-reload the pages (no embedded app)
pnpm --filter @wrx/site e2e    # build under a nested base path and check it offline
```

`pnpm build` builds the site too. The build logic is in `tools/site/build-site.ts`: it writes the PR index, runs VitePress for the deploy target's base path, and copies `apps/web/dist` to `dist/app/`. Set `GITHUB_REPOSITORY`, or `--base`, to build for a GitHub Pages path.

## Layout

| Path | What |
| --- | --- |
| `pages/` | The pages. `blog/` holds the posts; a blog-only PR may change nothing else (DOC-23) |
| `pages/data-dictionary.md` | Includes `docs/data-dictionary.md` at build time (DOC-3) |
| `pages/prs.md` | Includes the PR index that `build-site.ts` writes to `.generated/` (DOC-9) |
| `.vitepress/config.ts` | Navigation, base path, and the Mermaid fence plugin |
| `.vitepress/theme/` | `Mermaid`, `AppDemo`, `DemoLink` and the work-in-progress banner |
| `e2e/` | Playwright: offline, Mermaid renders, embedded app, nested base path |

## Writing

- **Diagrams:** a ` ```mermaid ` fence renders as a diagram. `pnpm check:mermaid` parses every one.
- **The app:** `<AppDemo />` embeds this build's app; `<AppDemo snapshot="post-slug" />` a frozen snapshot (DOC-24); `<AppDemo demo />` the live demo of `main`.
- **Blog posts** go in `pages/blog/<slug>.md`, with flat front matter:

  ```yaml
  ---
  title: A short title
  date: 2026-10-24
  phase: 1
  status: work-in-progress # or gate (DOC-26)
  snapshotBranch: phase-1 # optional, with snapshotCommit, for a post that shows the app
  snapshotCommit: <full 40-character commit id>
  ---
  ```

  Work-in-progress posts get a banner saying so (DOC-26), and a gate post must link every work-in-progress post of its phase. `pnpm check:blog` checks both. Label the PR `blog`, or use a `blog/` branch, for it to auto-merge (DOC-23).
- **Security detail stays off the site (DOC-2).** CI scans every built page against a deny-list kept in `tools/site/`, outside this folder, so the list itself is never published.

## Why VitePress (DOC-15)

DOC-15 leaves the generator to the team, provided it builds statically and offline, renders Mermaid, and can embed live demos in posts. We compared VitePress, Astro with Starlight, and Docusaurus.

| | VitePress 1.6.4 | Astro 7 + Starlight 0.42 | Docusaurus 3.10 |
| --- | --- | --- | --- |
| Static, offline build | Yes | Yes | Yes |
| Offline search | Built in (`provider: 'local'`) | Pagefind, built in | Needs a plugin; the default is Algolia, a hosted service |
| Mermaid | A fence plugin and a 50-line component importing the `mermaid` package | `rehype-mermaid` renders at build time in a headless browser, or a client component as here | `@docusaurus/theme-mermaid`, built in |
| Embedding the app | Vue components in Markdown | Astro components in MDX | React components in MDX |
| Including generated Markdown | `<!--@include: -->`, built in | Needs a custom loader | Needs MDX imports |
| Release at least 14 days old | 1.6.4 (Aug 2025), the stable line | 7.3.8; the 7.4 line is under 14 days old | 3.10.2 (Jul 2026) |
| UI framework | Vue, used only inside the site | Any, islands | React, as the app |

VitePress was chosen because it meets every DOC-15 condition with the fewest moving parts:

- **Mermaid with no CDN.** The fence plugin turns each ` ```mermaid ` block into a component that imports the bundled `mermaid` package, so diagrams render from files on the same host. The e2e test blocks every request to another origin and checks that all five architecture diagrams render.
- **Generated content without copying.** The data dictionary and PR index are included at build time by VitePress's own `@include`, so neither is ever hand-copied (DOC-3, DOC-9).
- **Live demos.** Vue components work inline in Markdown, so `<AppDemo />` drops an iframe of the app into any page or post.
- **Offline search** is built in, with no hosted service.
- **Small and stable.** One dependency with its theme built in; the whole site, Mermaid included, builds in about 35 s. 1.6.4 is the stable line; 2.0 is still alpha.

Docusaurus would share React with the app, but needs a search plugin for offline use and MDX imports for generated content. Astro is the closest alternative; it would suit a site that grows many custom pages.

The costs: VitePress 1.x runs on Vite 5 while the app uses Vite 8 (they are separate packages, so they don't conflict), and VitePress needs one absolute base path per build, so each deploy target gets its own build. The embedded app keeps its relative base and runs anywhere (DOC-11).
