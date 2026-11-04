// S16-1 to S16-3 against the config under test (S1516_CONFIG: ref or tight).
import { backend, raw } from '../../src/backend.ts'
import { s16 } from '../../src/checks/s16-shaper.ts'
import { CONFIG } from '../../src/config.ts'
import { makeCtx } from '../../src/context.ts'

s16(makeCtx(backend, raw), CONFIG)
