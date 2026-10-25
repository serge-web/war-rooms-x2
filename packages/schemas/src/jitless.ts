// zod compiles object parsers with `new Function` when it can, and probes for that when each
// object schema is built: a call that a Content-Security-Policy without 'unsafe-eval' refuses
// and reports (security review F7). This turns that off. It must run before any zod schema is
// built, so an entry point (the app's main.tsx, the mock's SharedWorker) imports it first;
// `@wrx/schemas` itself imports it too, for everything else (tests, tools).
import { z } from 'zod'

z.config({ jitless: true })
