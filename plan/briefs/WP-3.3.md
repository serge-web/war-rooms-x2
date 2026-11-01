# WP 3.3 — Reference deployment and air-gapped install

**SRD ids:** NFR-2, NFR-4, NFR-10, NFR-22, NFR-23 · **Depends on:** 0.4, 1.3 · **Status:** to do (the real-hardware check needs a person)

## Goal

Everything needed to deploy WRX1 on an internal or air-gapped network, built and tested here, ready for a person to verify on real hardware (NFR-23).

## Acceptance

- **Container image (NFR-10):** one command brings up ejabberd with the reference config and serves the built client. ejabberd is pinned by digest, `wss://` only, SCRAM-SHA-256, no REST `/api`, no web admin and no `mod_adhoc_api`, in-band registration off, and a per-player rate limit (NFR-22). It also sends the CSP header from `deploy/README.md`.
- **Offline install (NFR-23):** `ops/offline-install.sh` with a matching bundle script. It packs images and the client on a connected machine, then installs on a host with no network. It is tested here in a container with networking off, as far as a container allows.
- **Internal CA (NFR-2):** a guide and scripts for server certificates from an internal CA, and for trusting that CA in browsers. `deploy/ejabberd/make-ca.sh` is the starting point.
- **Setup guide (NFR-4):** the server settings WRX1 relies on, and how the admin backend verifies them at publish (room config, MAM enabled).
- **Backup and restore:** what to back up, and how (ejabberd's database and the uploaded assets), with a restore tested on the stack.
- **Left for a person:** the real-hardware run and the answers to WP 0.4, recorded in `plan/decisions/target-environment.md` once known.

## Owns

`deploy/`, `ops/`, and the deployment docs on the site (keeping secrets and deny-listed terms off it).
