# WP 0.3 — StanzaJS health check (P4)

**SRD ids:** ARC-1, ARC-12 · **Depends on:** — · **Status:** done

## Goal

Confirm StanzaJS can carry the XMPP-level transport, or name a fallback library.

## Acceptance

A decision record, `plan/decisions/xmpp-library.md`, covering:

- maintenance: last release, open issues, whether it builds with the repo's TypeScript and bundler;
- typed support for XEP-0045 (MUC owner and admin), XEP-0060 (owner operations and affiliations), XEP-0313 with XEP-0059 RSM, XEP-0133 ad-hoc commands, XEP-0198 and SASL ANONYMOUS and SCRAM-SHA-256;
- a small script that logs in to the reference ejabberd over `wss://`, joins a room, pages MAM and runs one XEP-0133 command;
- if StanzaJS falls short: the gap, and the fallback (for example `@xmpp/client` with hand-written stanza builders) with the same script.

## Owns

`spike/xmpp-library/`, `plan/decisions/xmpp-library.md`

## Consumes

The reference deployment in the spike repo (read-only).
