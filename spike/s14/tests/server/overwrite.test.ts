// S14-8 against the config under test (S14_CONFIG).
import { backend, raw } from '../../src/backend.ts'
import { overwrite } from '../../src/checks/overwrite.ts'
import { CONFIG } from '../../src/config.ts'
import { makeCtx } from '../../src/context.ts'

overwrite(makeCtx(backend, raw), { expectCollections: CONFIG !== 'v0' })
