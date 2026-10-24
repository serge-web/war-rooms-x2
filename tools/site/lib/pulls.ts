// The PR index (DOC-9): open and merged PRs, newest first, with status, merge date and
// preview link. Built from the GitHub API's pull list, which the deploy workflow saves.
import { arr, field, num, optStr, str } from './json.ts'

export interface Pull {
  readonly number: number
  readonly title: string
  readonly url: string
  readonly state: 'open' | 'closed'
  readonly draft: boolean
  readonly mergedAt: string | null
  readonly author: string
  /** From a fork, or a deleted head repo: no preview (DOC-6). */
  readonly fromFork: boolean
}

export type PullStatus = 'draft' | 'open' | 'merged'

export interface IndexEntry {
  readonly number: number
  readonly title: string
  readonly url: string
  readonly status: PullStatus
  /** `YYYY-MM-DD`, for merged PRs. */
  readonly mergedOn: string | null
  readonly hasPreview: boolean
}

/** Bots whose PRs the preview workflow skips, because their token can't deploy. */
const NO_PREVIEW_AUTHORS: readonly string[] = ['dependabot[bot]']

/** Reads `GET /repos/{repo}/pulls?state=all` output: one array, or one array per page. */
export function parsePulls(json: unknown, repository: string): Pull[] {
  const items = arr(json, 'pulls').flatMap((item) =>
    Array.isArray(item) ? arr(item, 'page') : [item],
  )
  return items.map((item: unknown, i) => {
    const at = `pulls[${i}]`
    const state = str(field(item, 'state'), `${at}.state`)
    if (state !== 'open' && state !== 'closed') throw new Error(`Unknown state ${state} at ${at}`)
    const url = str(field(item, 'html_url'), `${at}.html_url`)
    if (!/^https:\/\/[^\s()<>"']+$/.test(url)) throw new Error(`Unexpected URL at ${at}`)
    const headRepo = optStr(field(field(field(item, 'head'), 'repo'), 'full_name'), `${at}.head`)
    return {
      number: num(field(item, 'number'), `${at}.number`),
      title: str(field(item, 'title'), `${at}.title`),
      url,
      state,
      draft: field(item, 'draft') === true,
      mergedAt: optStr(field(item, 'merged_at'), `${at}.merged_at`),
      author: str(field(field(item, 'user'), 'login'), `${at}.user.login`),
      fromFork: headRepo?.toLowerCase() !== repository.toLowerCase(),
    }
  })
}

export function indexEntries(pulls: readonly Pull[]): IndexEntry[] {
  return pulls
    .filter((pull) => pull.state === 'open' || pull.mergedAt !== null)
    .map((pull): IndexEntry => ({
      number: pull.number,
      title: pull.title,
      url: pull.url,
      status: pull.mergedAt !== null ? 'merged' : pull.draft ? 'draft' : 'open',
      mergedOn: pull.mergedAt?.slice(0, 10) ?? null,
      hasPreview: !pull.fromFork && !NO_PREVIEW_AUTHORS.includes(pull.author),
    }))
    .sort((a, b) => b.number - a.number)
}

/** Escapes text for a Markdown table cell, so a PR title can't add markup or links. */
export function escapeCell(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]|~#!]/g, (c) => `\\${c}`)
}

export interface IndexOptions {
  /** URL path of the gh-pages root, e.g. `/war-rooms-x2/`. */
  readonly pagesRoot: string
}

/**
 * The index as Markdown, for the site's PR index page to include. Links are plain anchors
 * with a target, so VitePress's router leaves them to the browser: previews sit outside
 * this build's base path.
 */
export function renderPrIndex(entries: readonly IndexEntry[] | null, options: IndexOptions) {
  const demo = `<a href="${options.pagesRoot}demo/" target="_self">live demo</a>`
  const lines = [`The ${demo} runs the latest build of \`main\` on the mock backend (DOC-16).`, '']
  if (entries === null) {
    lines.push(
      'This build was made without PR data. The deploy workflows fill this index from the GitHub API.',
    )
  } else if (entries.length === 0) {
    lines.push('No open or merged PRs yet.')
  } else {
    lines.push(
      '::: v-pre',
      '| PR | Title | Status | Merged | Preview |',
      '| --: | --- | --- | --- | --- |',
      ...entries.map((e) => {
        const link = `[#${e.number}](${e.url})`
        const preview = e.hasPreview
          ? `<a href="${options.pagesRoot}pr/${e.number}/" target="_self">pr/${e.number}</a>`
          : 'none'
        return `| ${link} | ${escapeCell(e.title)} | ${e.status} | ${e.mergedOn ?? ''} | ${preview} |`
      }),
      ':::',
    )
  }
  return `${lines.join('\n')}\n`
}
