# Architecture

This page has one diagram per sub-system. A pull request that changes a sub-system updates its diagram here.

## The client, as planned

The client is layered so that every pane of the multi-client view is independent, and swapping the real XMPP server for the in-browser mock changes only the transport. Phases 1 and 2 build these layers; the sections below show what exists today.

```mermaid
flowchart TB
    subgraph Pane["Each pane, one per client in the multi-client view"]
        direction TB
        UI["UI: presentational components and room-type panels"]
        Hooks["Hooks: thin store subscriptions"]
        Store["Session store and domain layer"]
        Transport["XMPP-level transport interface"]
        UI --> Hooks --> Store --> Transport
    end
    Schemas["Runtime schemas: packages/schemas"]
    Store --> Schemas
    Transport --> Real["Real transport: StanzaJS plus a server adapter"]
    Transport --> Mock["Mock: shared in-browser server"]
    Real --> Server[("ejabberd")]
    Mock --> Host[("SharedWorker or leader tab, IndexedDB")]
```

## Schemas

`packages/schemas` holds a zod schema for every PubSub document and message body, and the TypeScript types inferred from them. The [data dictionary](./data-dictionary) is generated from the same schemas, so the documentation cannot drift from the code.

```mermaid
flowchart LR
    common["common.ts: slugs, colours, names, limits"]
    theme["theme.ts: theme tokens and assets"]
    documents["documents.ts: game setup, force, role, room, objectives, asset, announcement, game state"]
    message["message.ts: message bodies, by type"]
    nodes["nodes.ts: PubSub node names"]
    parse["parse.ts: parseDocument, migration by schemaVersion"]
    design["design.ts: design export file and cross-document checks"]
    size["size.ts: item size checks"]
    catalogue["catalogue.ts: what the dictionary documents"]
    dictionary["dictionary.ts: renders Markdown"]
    script["scripts/generate-dictionary.ts"]
    out[("docs/data-dictionary.md")]

    common --> theme --> documents
    common --> message
    common --> nodes
    common --> size
    documents --> parse
    message --> parse
    documents --> design
    documents & message & design & theme --> catalogue --> dictionary --> script --> out
```

## Web app shell

`apps/web` is a Vite and React app. Today it is a shell that shows which backend it uses; the player client and admin backend are built in Phase 2. It builds with relative asset URLs, so one build runs under any base path.

```mermaid
flowchart LR
    html["index.html"] --> main["main.tsx: createRoot, StrictMode"]
    main --> App["App: header and status"]
    App --> Badge["BackendBadge: MOCK or the server address"]
    main -. "mock for now" .-> Backend{{"Backend: mock or xmpp"}}
    App --> css["app.css: theme tokens as CSS custom properties"]
    build["vite build, base ./"] --> dist[("apps/web/dist")]
    e2e["Playwright smoke tests"] --> dist
```

## CI tools

`tools/` holds the checks that run on every pull request, and the repo's own lint rule.

```mermaid
flowchart LR
    subgraph CI["GitHub Actions: ci.yml"]
        direction TB
        checks["Type check, lint, format, unit tests"]
        trace["check-traceability.ts"]
        dict["Dictionary is current"]
        mermaid["check-mermaid.ts"]
        bundle["check-bundle.ts"]
        e2e["Playwright"]
    end
    trace --> traceLib["lib/trace.ts: every requirement has a work package"]
    mermaid --> md["lib/markdown.ts: Mermaid blocks in all Markdown"]
    mermaid --> chromium["Chromium, with the bundled mermaid build"]
    bundle --> dist[("apps/web/dist: relative URLs only")]
    checks --> rule["eslint-rules: no module-level mutable state"]
```

## Site and previews

This site is built with VitePress from `site/`, with the app embedded at `app/`. The workflows deploy it to the `gh-pages` branch through one queue: the site root and the live demo from `main`, a preview of every pull request, and frozen snapshots for blog posts.

```mermaid
flowchart TB
    subgraph Build["Build: tools/site/build-site.ts"]
        direction TB
        pages["site/pages: Markdown pages and blog posts"]
        dict[("docs/data-dictionary.md")]
        pulls["PR list from the GitHub API"]
        index["lib/pulls.ts: PR index"]
        vp["VitePress, with Mermaid and the demo embed"]
        app[("apps/web/dist")]
        pulls --> index --> vp
        pages --> vp
        dict --> vp
        vp --> out[("site/dist")]
        app --> out
    end
    subgraph Checks["Site checks"]
        deny["Deny-list scan"]
        secrets["Secrets and endpoint scan"]
        sizeCheck["Size report"]
    end
    subgraph Shots["Screenshots: tools/screenshots"]
        capture["capture.ts: tagged Playwright scenarios, fixed clock, run twice"]
        compareShots["compare.ts: against main's published set"]
        capture --> compareShots
    end
    out --> Checks
    Checks --> Shots
    compareShots --> comment["PR comment: changed and new shots"]
    Shots --> Queue["Deploy queue: one at a time, retried on conflict"]
    Queue --> ghp[("gh-pages")]
    ghp --> root["root: the site, from main"]
    ghp --> demo["demo: the app, from main"]
    ghp --> pr["pr/n: one preview per pull request"]
    ghp --> snap["snapshots/slug: frozen builds for blog posts"]
```

Each build also takes screenshots when a pull request changes the app or the site. The scenarios run on a fixed clock, and each build takes them twice and fails if the two runs differ, so an image changes only when the page does. A preview keeps only the screenshots that differ from `main`, with `main`'s version beside each changed one; the root keeps the full set, which later pull requests compare against.
