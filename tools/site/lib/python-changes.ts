// Whether a PR preview carries the Python runner and Pyodide in the app's `py/` (owner decision,
// Nov 6, 2026; WP 6.4): only when the PR touches the runner, the SDK or Python files, since `py/`
// is 23 MB in every preview kept on GitHub Pages. The main site always carries it. A preview
// without it builds with WRX_PY_RUNNER=off, and its Scripts panel says Python is unavailable.
const PATTERNS: readonly RegExp[] = Object.freeze([
  // The runner: the worker, the bridge, its build plugin and the Pyodide lock.
  /^packages\/py-runner\//,
  // The SDK, its tests and fixtures.
  /^python\//,
  // The bridge protocol both sides speak.
  /^packages\/schemas\/src\/bridge(?:\.test)?\.ts$/,
  // Any Python file, and this rule itself.
  /\.py$/,
  /^tools\/site\/lib\/python-changes(?:\.test)?\.ts$/,
])

export function touchesPython(paths: readonly string[]): boolean {
  return paths.some((path) => PATTERNS.some((pattern) => pattern.test(path)))
}
