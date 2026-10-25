/**
 * True in the real-server build (`vite build --mode server`), which reads config.json and
 * bundles the XMPP transport; false in the mock-only build used for previews, the demo,
 * snapshots and the site (DOC-12). Set by vite.config.ts.
 */
declare const __WRX_REAL_SERVER__: boolean
