# War Rooms X2

Distributed wargame environment, focusing on command and control. This repo builds **War Rooms X1 (WRX1)** v1: admin-designed, chat-based wargames with an ejabberd XMPP server as the only backend.

## Plan

Work packages and their status: grey to do, amber active, green done. Every PR updates this chart (DOC-22); see [how PRs update the chart](WRX1-Dev-Plan.md#the-readme-plan-chart).

```mermaid
flowchart TB
    subgraph P0["Phase 0 — Foundations"]
        direction LR
        wp01["0.1 S13 and stanza cap"]
        wp02["0.2 Layout library eval"]
        wp03["0.3 StanzaJS health"]
        wp04["0.4 Target environment"]
        wp05["0.5 Scaffold and README plan"]
        wp06["0.6 Site and PR previews"]
        wp07["0.7 Screenshot pipeline"]
        wp08["0.8 Schemas and dictionary"]
    end
    subgraph P1["Phase 1 — Contracts and transports"]
        direction LR
        wp11["1.1 Transport interface"]
        wp12["1.2 Contract suite"]
        wp13["1.3 Real transport"]
        wp14["1.4 Mock server core"]
        wp15["1.5 Mock hosting"]
        wp16["1.6 Domain layer, hooks, registry"]
    end
    subgraph P2["Phase 2 — Features"]
        direction LR
        wp21["2.1 AdminOps"]
        wp22["2.2 Design editor"]
        wp23["2.3 Publish and provisioning"]
        wp210["2.10 Audit and repair"]
        wp24["2.4 Player shell"]
        wp25["2.5 Workspace"]
        wp26["2.6 Chat panel"]
        wp27["2.7 Out-of-game column"]
        wp28["2.8 Themes"]
        wp29["2.9 Multi-client and seeds"]
    end
    subgraph P3["Phase 3 — Acceptance"]
        direction LR
        wp31["3.1 Scenarios SC-1 to SC-9"]
        wp32["3.2 Performance and a11y"]
        wp33["3.3 Air-gapped install"]
        wp34["3.4 Security review and release"]
    end
    G0{{"Gate G0"}}
    G1{{"Gate G1"}}
    G2{{"Gate G2"}}
    G3{{"Gate G3 — v1"}}

    wp05 --> wp06 --> wp07
    wp05 --> wp08
    wp03 & wp08 --> wp11
    wp11 --> wp12 & wp13 & wp14 & wp16
    wp14 --> wp15
    wp13 & wp16 & wp01 --> wp21
    wp16 --> wp22
    wp21 & wp22 --> wp23 --> wp210
    wp16 --> wp24
    wp02 & wp24 --> wp25 --> wp26
    wp25 & wp21 --> wp27
    wp16 & wp22 --> wp28
    wp15 & wp25 --> wp29
    wp04 & wp13 --> wp33
    wp31 & wp32 & wp33 --> wp34
    P0 -.-> G0
    P1 -.-> G1
    P2 -.-> G2
    G2 --> wp31 & wp32
    P3 -.-> G3

    classDef todo fill:#f2f2f2,stroke:#888,color:#222
    classDef active fill:#fff1c2,stroke:#c9a000,color:#222,stroke-width:2px
    classDef done fill:#d6f0dc,stroke:#2e7d32,color:#222
    classDef gate fill:#e3ecfa,stroke:#3b5bab,color:#222
    class wp01,wp02,wp03,wp04,wp06,wp07,wp11,wp12,wp13,wp14,wp15,wp16,wp21,wp22,wp23,wp210,wp24,wp25,wp26,wp27,wp28,wp29,wp31,wp32,wp33,wp34 todo
    class wp05,wp08 done
    class G0,G1,G2,G3 gate
```

## Documents

- [Software requirements (SRD)](WRX1-SRD.md)
- [Development plan](WRX1-Dev-Plan.md) and [work package briefs](plan/briefs/)
- [Data dictionary](docs/data-dictionary.md), generated from the schemas

## Repo layout

| Path | What |
| --- | --- |
| `packages/schemas` | Runtime schemas (zod) for every PubSub document and message body, and the types inferred from them (WP 0.8) |
| `apps/web` | The web app. A shell for now; the player client and admin backend are built in Phase 2 |
| `tools` | CI checks and the local ESLint rules |
| `plan/briefs` | One brief per work package |

## Development

Needs Node 22 and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm check            # type check, lint, format, unit tests, traceability, dictionary
pnpm e2e              # Playwright, against a production build
pnpm check:mermaid    # every Mermaid block in the repo's Markdown parses
pnpm dictionary       # regenerate docs/data-dictionary.md after a schema change
pnpm --filter @wrx/web dev
```
