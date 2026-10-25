# Deploying the web client

`deploy/ejabberd` is the reference ejabberd used by the contract suite and CI (NFR-22). This page covers the HTTP headers for hosting the built client (`apps/web/server-build/dist`).

## Content-Security-Policy (security review F7)

The built `index.html` carries a Content-Security-Policy `<meta>` tag (`contentSecurityPolicy` in `apps/web/vite.config.ts`), and `popout.html` carries its own. A host that can set response headers should also send the policy as a header, since a `<meta>` policy cannot carry `frame-ancestors` and does not cover the mock's SharedWorker script:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' wss://xmpp.example.org; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

- **`connect-src`**: replace `wss://xmpp.example.org` with the `websocketUrl` from your `config.json`. If the WebSocket is a path on the same origin (`"/ws"` behind a reverse proxy), `'self'` covers it and the host can be left out. The built-in `<meta>` policy allows any `wss:` host (and plain `ws:` to this machine only), because `config.json` is read at run time and the build cannot know the host. The header narrows that to your server: a browser enforces both policies, so the stricter one wins.
- **`frame-ancestors`**: `'self'` lets the project site embed the demo in an iframe on the same origin. Use `'none'` if the client is never embedded.
- **No `'unsafe-eval'` and no inline script.** zod runs without its `new Function` compiler (`@wrx/schemas/jitless`). `'unsafe-inline'` is needed for styles only: React style attributes, FlexLayout and popped-out windows use them.
- **Popouts** (`popout.html`) run no script of their own; the opener renders into them. Serve them with the same header.
