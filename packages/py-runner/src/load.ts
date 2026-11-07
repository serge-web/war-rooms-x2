// Loads the runner (PY-5): a dynamic import of `py/runner.js` from the app's own build, by URL,
// so the bundler never pulls the runner into the chunk that calls this. This module is all a
// page needs at start-up (a few hundred bytes); the runner, its worker and Pyodide load only
// when this is called, which the script panel (6.3) does when it first opens.

/** The folder of the app's build that holds the runner, relative to the page (fixed). */
export const RUNNER_FOLDER = 'py/'
export const RUNNER_FILE = 'runner.js'

export type RunnerModule = typeof import('./index.ts')

/** Imports the runner from `base` (default the document's base URL, so any base path works). */
export function loadRunner(base: string = document.baseURI): Promise<RunnerModule> {
  const url = new URL(`${RUNNER_FOLDER}${RUNNER_FILE}`, base).href
  return import(/* @vite-ignore */ url) as Promise<RunnerModule>
}
