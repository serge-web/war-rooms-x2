// Screenshots run only when a PR touches what they show: the app, the site, the packages the
// app uses, or the screenshot scenarios themselves (WP 0.7).
const PATTERNS: readonly RegExp[] = Object.freeze([
  /^apps\//,
  /^site\//,
  /^packages\//,
  /^tools\/screenshots\//,
  /^tools\/site\/build-site\.ts$/,
  /^pnpm-lock\.yaml$/,
])

export function touchesUi(paths: readonly string[]): boolean {
  return paths.some((path) => PATTERNS.some((pattern) => pattern.test(path)))
}
