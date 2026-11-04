// S15-1 to S15-5 and S15-7 against the config under test (S1516_CONFIG, normally ref).
import { backend, raw } from '../../src/backend.ts'
import { s15 } from '../../src/checks/s15-timestamps.ts'
import { makeCtx } from '../../src/context.ts'

s15(makeCtx(backend, raw))
