// S14-5 (600 and 1,200 leaves, with and without a collection) and S14-10 (the fallback layout).
import { backend, raw } from '../../src/backend.ts'
import { scale } from '../../src/checks/scale.ts'
import { CONFIG } from '../../src/config.ts'
import { makeCtx } from '../../src/context.ts'

scale(makeCtx(backend, raw), { expectCollections: CONFIG !== 'v0' })
