# Decision: target environment (WP 0.4, P2)

**Status:** answered, 2026-11-01, by the product owner (Ian Mayo) · **SRD ids:** D12, D17, NFR-2, NFR-13, NFR-23 · **Changes:** NFR-13 (SRD §14), the CI browser jobs, `ops/README.md`

## Answers

| # | Question | Answer | What it changes |
| --- | --- | --- | --- |
| 1 | Which browsers and versions do the analysts use? | **Chrome and Edge only**, current versions. Firefox and Safari are nice to have. | NFR-13 now reads: "Current Chrome and Edge SHALL be supported; Firefox and Safari SHOULD be." CI's Firefox job becomes advisory, like WebKit's (`.github/workflows/ci.yml`, `e2e-browsers`); Chromium in `build-e2e` stays required. Known Firefox and WebKit failures are recorded in `plan/reviews/phase-3-browsers.md`. |
| 2 | Do the analysts' browsers allow SharedWorker, IndexedDB and Web Locks, which the mock needs (D17)? | **The mock is not needed on customer machines.** Demos run only on our own laptops. | Nothing to build. The mock's browser APIs (D17) are a concern for our demo laptops only; the real-server build on customer machines keeps layouts and admin drafts in `localStorage`, which current Chrome and Edge allow, and works without it if it is blocked. Step 5 of the real-hardware checklist no longer needs to check SharedWorker or Web Locks. |
| 3 | Is approval needed to run ejabberd (Erlang) on internal and air-gapped hosts, and who gives it? | **No special approval is needed.** | Nothing to change. The pinned image and Docker Engine are used as they are. |
| 4 | Which install route: containers or a native install? | **Either is fine.** Containers are the primary route; a native install is documented as the alternative. | The container route (`ops/offline-install.sh`) stays the one that is built and tested. The native route runs the same `deploy/ejabberd/ejabberd.yml` on a native ejabberd 26.09, with `ejabberdctl` in place of `docker compose exec`; it is described in `ops/README.md` as an alternative. The scripts have no native mode, and none is planned unless a customer asks for it. |
| 5 | Is there an internal CA, and how do its certificates reach the browsers (NFR-2)? | **Not known yet.** | Every route stays documented and supported: the customer's CA through a signing request (`ops/ca/issue-server-cert.sh --csr-only`), our internal CA (`ops/ca/make-internal-ca.sh`), or a CA made per install. Ask again before the first deployment. |
| 6 | Who verifies the air-gapped install on real hardware (NFR-23), and on what hardware? | **The product owner (Ian), on a spare machine**, using the checklist in `ops/README.md` ("The real-hardware run"). | NFR-23 stays open until that run is done and its result is added here. The bundle is `linux/amd64` unless the spare machine is ARM (`make-bundle.sh --platform linux/arm64`). |

## The real-hardware run (NFR-23)

Not done yet. When it is, record here: the machine (OS, kernel, CPU, Docker version, disk), the bundle's version and SHA-256, the CA route used, and the result of each step of the checklist in `ops/README.md`.

**Update, Nov 3, 2026.** The product owner dropped Firefox support: Chrome and Edge are SHALL, Safari SHOULD, and CI no longer runs Firefox (SRD NFR-13).
