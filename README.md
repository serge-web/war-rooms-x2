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
        wp211["2.11 White Force and admin umpire"]
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
        wp35["3.5 GUID ids, login names, admin-only objectives"]
    end
    subgraph P4["Phase 4 — Message templates"]
        direction LR
        wp41["4.1 Template model"]
        wp42["4.2 Composer and card"]
        wp43["4.3 Template editor"]
        wp44["4.4 Acceptance and review"]
    end
    subgraph P5["Phase 5 — Turns and the map"]
        direction LR
        wp51["5.1 Spike checks S15–S16"]
        wp52["5.2 Turn and world-state model"]
        wp53["5.3 Design, publish and layout changes"]
        wp54["5.4 Turns and turn panel"]
        wp55["5.5 Map room"]
        wp56["5.6 World-state editor"]
        wp58["5.8 White Force edits objectives"]
        wp57["5.7 Acceptance and review"]
        wp59["5.9 Phase 5 polish"]
    end
    subgraph P6["Phase 6 — Python API (after v1)"]
        direction LR
        wp61["6.1 SDK models and read layer"]
        wp62["6.2 Browser runner and packaging"]
        wp63["6.3 Script panel and storage"]
        wp64["6.4 Act and adjudicate"]
        wp65["6.5 Acceptance and review"]
    end
    subgraph PX["After v1 — Annexes A to C"]
        direction LR
        wps14["S14 Collection access spike"]
        wps17["S17 Pyodide spike"]
    end
    G0{{"Gate G0"}}
    G1{{"Gate G1"}}
    G2{{"Gate G2"}}
    G3{{"Gate G3 — v1"}}
    G4{{"Gate G4 — templates"}}
    G5{{"Gate G5 — turns and map"}}
    G6{{"Gate G6 — Python API"}}

    wp05 --> wp06 --> wp07
    wp05 --> wp08
    wp03 & wp08 --> wp11
    wp11 --> wp12 & wp13 & wp14 & wp16
    wp14 --> wp15
    wp13 & wp16 & wp01 --> wp21
    wp16 --> wp22
    wp21 & wp22 --> wp23 --> wp210
    wp210 & wp27 --> wp211
    wp16 --> wp24
    wp02 & wp24 --> wp25 --> wp26
    wp25 & wp21 --> wp27
    wp16 & wp22 --> wp28
    wp15 & wp25 --> wp29
    wp04 & wp13 --> wp33
    wp31 & wp32 & wp33 --> wp34
    wp35 --> wp34
    wp12 --> wps14
    wp56 --> wps17
    P0 -.-> G0
    P1 -.-> G1
    P2 -.-> G2
    G2 --> wp31 & wp32 & wp35
    P3 -.-> G3
    G3 --> wp41
    wp41 --> wp42 & wp43
    wp42 & wp43 --> wp44
    P4 -.-> G4
    G4 --> wp52
    wp12 --> wp51
    wp52 --> wp53 & wp54 & wp55
    wp54 & wp55 --> wp56
    wp51 --> wp58
    wp53 & wp56 & wp58 --> wp57
    wp57 --> wp59
    P5 -.-> G5
    wps17 --> wp61
    wp61 --> wp62
    wp62 --> wp63
    wp63 --> wp64
    wp64 --> wp65
    P6 -.-> G6

    classDef todo fill:#f2f2f2,stroke:#888,color:#222
    classDef active fill:#fff1c2,stroke:#c9a000,color:#222,stroke-width:2px
    classDef done fill:#d6f0dc,stroke:#2e7d32,color:#222
    classDef gate fill:#e3ecfa,stroke:#3b5bab,color:#222
    class wp01,wp02,wp03,wp04,wp05,wp06,wp07,wp08,wp11,wp12,wp13,wp14,wp15,wp16,wp21,wp22,wp23,wp24,wp25,wp26,wp27,wp28,wp29,wp210,wp211,wp31,wp32,wp35,wps14,wp41,wp42,wp43,wp44,wp51,wp58,wp52,wp54,wp53,wp55,wp56,wp57,wp59 done
    class wp33,wp34 active
    class wps17 done
    class wp61,wp62,wp63,wp64 done
    class wp65 done
    class G0,G1,G2,G3,G4,G5,G6 gate
```

## Documents

- [Software requirements (SRD)](WRX1-SRD.md)
- [Development plan](WRX1-Dev-Plan.md) and [work package briefs](plan/briefs/)
- [Data dictionary](docs/data-dictionary.md), generated from the schemas
- [Release notes](RELEASE-NOTES.md)
- [Decision records](plan/decisions/) and [reviews](plan/reviews/) (internal)

## Repo layout

| Path | What |
| --- | --- |
| `packages/schemas` | Runtime schemas (zod) for every PubSub document and message body, and the types inferred from them (WP 0.8) |
| `apps/web` | The web app: player client, admin backend and multi-client view, with the e2e scenarios |
| `deploy` | The reference ejabberd config, the contract-suite stack and the reference deployment (WP 3.3); its README is the setup guide |
| `ops` | Offline bundle and install, internal CA, checks, backup and restore, and their tests (WP 3.3) |
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
