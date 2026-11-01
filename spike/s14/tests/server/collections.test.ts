// S14-1 to S14-4, S14-6 and S14-7 against the config under test (S14_CONFIG).
import { backend, raw } from '../../src/backend.ts'
import { collections } from '../../src/checks/collections.ts'
import { CONFIG } from '../../src/config.ts'
import { makeCtx } from '../../src/context.ts'

collections(makeCtx(backend, raw), { expectCollections: CONFIG !== 'v0' })
