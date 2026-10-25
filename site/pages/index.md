---
layout: home
hero:
  name: War Rooms X1
  text: Chat-based wargames in the browser
  tagline: Games designed by an admin, played in a dockable chat workspace, with an XMPP server as the only backend.
  actions:
    - theme: brand
      text: Background
      link: /background
    - theme: alt
      text: Architecture
      link: /architecture
    - theme: alt
      text: PR index
      link: /prs
features:
  - title: One backend
    details: All game data lives in a standard XMPP server, ejabberd. There is no app server and no database.
  - title: Mock backend for demos
    details: A browser-only mock server stands in for XMPP, so any build can be tried without installing anything.
  - title: Runs offline
    details: Every asset is bundled, so the client runs on air-gapped and internal networks.
  - title: Built in the open
    details: Every pull request gets a live preview of this site and the app, listed in the PR index.
---

## Try it

Below is the app from this build, running on the mock backend. The <DemoLink>live demo</DemoLink> always runs the latest build of `main`.

<AppDemo />

The app has the welcome page and login, the players' chat workspace, the admin's design editor and publishing at `#/admin`, and a multi-client view at `#/multi`. Use the demo logins listed on the welcome page; `admin` plays as the umpire. The [blog](/blog/) follows progress.
