// Fills the wheel cache (src/packaging.ts) ahead of a build, e.g. to warm CI's cache:
//
//   pnpm --filter @wrx/py-runner fetch
//   WRX_PYODIDE_RELEASE=/path/to/extracted/pyodide pnpm --filter @wrx/py-runner fetch
import { ensureWheels, verifyCore } from '../src/packaging.ts'

verifyCore()
await ensureWheels(undefined, (line) => {
  console.log(line)
})
