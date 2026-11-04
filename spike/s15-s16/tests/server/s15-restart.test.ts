// S15-6 against the config under test: restarts its container once.
import { backend, raw } from '../../src/backend.ts'
import { s15Restart } from '../../src/checks/s15-restart.ts'
import { CONFIG } from '../../src/config.ts'
import { makeCtx } from '../../src/context.ts'

s15Restart(makeCtx(backend, raw), CONFIG)
