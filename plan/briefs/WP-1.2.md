# WP 1.2 — Contract suite

**SRD ids:** NFR-16, NFR-21, ARC-10–11 · **Depends on:** 1.1 · **Status:** done

## Goal

One test suite that defines how the transport behaves, run against real ejabberd in CI, and later against the mock (from 1.4). It is the independent judge that the plan's risk table relies on.

## Acceptance

- `packages/contract-suite`: the spike's checks ported to the 1.1 interface, with each test citing its XEP section and the server's discretionary points (§11 step 2). The checks are:
  - S00 connectivity;
  - S01, S01b and C01 (the R1 tests that gate every ejabberd upgrade, NFR-22);
  - S02 PubSub ACLs;
  - S03 item size;
  - S04 admin provisioning;
  - S05 MAM paging;
  - S06 publisher notifications;
  - S10 anonymous access (NFR-21);
  - S11 two sessions on one role;
  - S12 live changes;
  - S13 from WP 0.1.
- Extensions that the mock will need: the error conditions for each refused operation (ARC-11), including a role change for an absent occupant (`not-allowed` by JID, `not-acceptable` by nickname; WP 0.1), and event ordering on join (ejabberd follows XEP-0045 §7.2.3: occupants, self-presence, history, subject).
- The suite takes a backend factory, so 1.4 can run it unchanged against the mock.
- A CI job, `contract-ejabberd`, using the reference stack copied to `deploy/ejabberd/` with its image pinned by digest. It runs on every push and PR, and fails, not skips, when the server is unreachable (NFR-16).
- R1 tests tagged, so the plan's "R1 tests" gate can be run on its own.

## Owns

`packages/contract-suite/`, `deploy/ejabberd/`, `.github/workflows/contract-*.yml`

## Consumes

`packages/transport` (1.1), and 1.3's implementation to run against.

## Notes

- The mock job joins CI in 1.4. Until then the suite runs on ejabberd only, so that "fail, not skip" holds from the first commit.
- 1.2 and 1.3 are developed together, but the suite must be written from the XEPs and the spike's evidence, not from 1.3's code, so it stays an independent judge.
