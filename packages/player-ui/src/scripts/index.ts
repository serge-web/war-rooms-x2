// The script panel (SRD Annex C PY-6, PY-7; WP 6.3). Only these small modules are in the
// start-up chunk; the panel is a lazy chunk, and the runner loads when the panel first opens.
// The styles load here, with the page, so a popped-out panel has them too (PLY-4).
import './scripts.css'

export { NoScriptsHere, useScriptRole } from './availability.tsx'
export { LazyScriptsPanel } from './lazy.tsx'
