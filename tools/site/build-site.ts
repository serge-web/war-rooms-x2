// Builds the whole site: VitePress pages, the PR index and data dictionary, and the app at
// <site>/app/ (DOC-1, DOC-6). The base path is the deploy target's, so the same command
// builds the root site, a PR preview or a local copy (DOC-11).
//
//   node tools/site/build-site.ts [--target root|pr/<n>] [--base /x/] [--pages-root /x/]
//                                 [--pulls pulls.json]
//
// GITHUB_REPOSITORY, SITE_PAGES_ROOT and SITE_PAGES_URL set the gh-pages location. With
// none of them the site is built for `/`.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { BUILD_INFO } from './lib/gh-pages.ts'
import { normaliseBase, pagesLocation, parseTarget, targetBase } from './lib/paths.ts'
import { indexEntries, parsePulls, renderPrIndex } from './lib/pulls.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))
const site = `${root}site`
const appDist = `${root}apps/web/dist`

const { values } = parseArgs({
  options: {
    target: { type: 'string', default: process.env.WRX_SITE_TARGET ?? 'root' },
    base: { type: 'string' },
    'pages-root': { type: 'string' },
    pulls: { type: 'string', default: process.env.WRX_PULLS_FILE },
  },
})

const target = parseTarget(values.target)
if (target.kind !== 'root' && target.kind !== 'pr') {
  throw new Error('The site is built for the root or a PR preview')
}
const location = pagesLocation({
  repository: process.env.GITHUB_REPOSITORY,
  root: values['pages-root'] ?? process.env.SITE_PAGES_ROOT,
  url: process.env.SITE_PAGES_URL,
})
const base = values.base === undefined ? targetBase(location, target) : normaliseBase(values.base)

const repository = process.env.GITHUB_REPOSITORY ?? ''
const pulls =
  values.pulls === undefined || values.pulls === ''
    ? null
    : indexEntries(parsePulls(JSON.parse(readFileSync(values.pulls, 'utf8')), repository))
mkdirSync(`${site}/.generated`, { recursive: true })
writeFileSync(`${site}/.generated/pr-index.md`, renderPrIndex(pulls, { pagesRoot: location.root }))

if (!existsSync(`${appDist}/index.html`)) {
  console.error('apps/web/dist is missing. Build the app first: pnpm --filter @wrx/web build')
  process.exit(1)
}

console.log(`Building the site for ${base} (gh-pages root ${location.root})`)
execFileSync('pnpm', ['exec', 'vitepress', 'build'], {
  cwd: site,
  stdio: 'inherit',
  env: {
    ...process.env,
    WRX_SITE_BASE: base,
    WRX_PAGES_ROOT: location.root,
  },
})

// The app is mock-only in every site build (DOC-12); check-site-bundle.ts verifies it.
cpSync(appDist, `${site}/dist/app`, { recursive: true })

// Lets a deploy tell an older build of the root site from a newer one.
try {
  const commit = (format: string) =>
    execFileSync('git', ['log', '-1', `--format=${format}`], { cwd: root, encoding: 'utf8' }).trim()
  const info = { commit: commit('%H'), committedAt: commit('%cI') }
  writeFileSync(`${site}/dist/${BUILD_INFO}`, `${JSON.stringify(info, null, 2)}\n`)
} catch {
  console.warn(`Not a git checkout, so ${BUILD_INFO} is left out`)
}
console.log(`Site built in site/dist, with the app at site/dist/app/ (${pulls?.length ?? 0} PRs)`)
