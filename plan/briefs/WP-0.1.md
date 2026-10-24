# WP 0.1 — S13 offline voice revocation, and the WebSocket stanza cap (P1)

**SRD ids:** ADM-37, R15 · **Depends on:** — · **Status:** to do

## Goal

Find out whether the admin can set the stored visitor role for an offline observer account, and whether ejabberd's `max_stanza_size` applies to the WebSocket listener. The answers decide ADM-37 (direct revocation or the encrypted vault) and the PLY-53 cap.

## Acceptance

- A runnable script against the reference ejabberd container (from `serge-web/xmpp-spike`, `spike/docker/ejabberd/`) that:
  - takes an observer account that is offline and has never joined;
  - revokes its voice as admin, using XEP-0133 commands or MUC owner operations over XMPP only, with no REST and without the observer's password;
  - logs in as the observer, joins, and asserts the join is as `visitor` and a post is rejected.
- The same script sends room messages of growing size and records the size at which the WebSocket listener rejects or drops the stanza, with and without `max_stanza_size` set.
- A decision record, `plan/decisions/S13.md`: pass or fail, the exact stanzas used, and the chosen ADM-37 route.

## Owns

`spike/s13/`, `plan/decisions/S13.md`

## Consumes

The reference deployment in the spike repo (read-only).

## Notes

- The spike repo is not in this repo's session scope yet; the session for this WP must add it with read access.
- The decision record is security-sensitive (DOC-2) and stays off the site.
