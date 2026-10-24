// A small GitHub REST client for the site workflows, with fetch injectable for tests.
import { arr, field, num, str } from './json.ts'
import type { IssueComment } from './comment.ts'
import { findMarkedComment } from './comment.ts'

export interface FetchResponse {
  readonly ok: boolean
  readonly status: number
  readonly headers: { get(name: string): string | null }
  json(): Promise<unknown>
  text(): Promise<string>
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<FetchResponse>

export class GitHubError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export interface GitHub {
  request(method: string, path: string, body?: unknown): Promise<unknown>
  /** Follows `Link: rel="next"` and concatenates the pages' arrays. */
  paginate(path: string): Promise<unknown[]>
}

export interface ClientOptions {
  readonly token: string
  readonly apiUrl?: string | undefined
  readonly fetch?: FetchLike | undefined
}

export function gitHub(options: ClientOptions): GitHub {
  const api = (options.apiUrl ?? 'https://api.github.com').replace(/\/$/, '')
  const doFetch: FetchLike = options.fetch ?? fetch
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${options.token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'wrx-site-tools',
  }

  async function send(method: string, url: string, body?: unknown) {
    const response = await doFetch(url, {
      method,
      headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new GitHubError(
        `GitHub ${method} ${url} failed: ${response.status} ${text.slice(0, 300)}`,
        response.status,
      )
    }
    return response
  }

  const absolute = (path: string) => (path.startsWith('https://') ? path : `${api}${path}`)

  return {
    async request(method, path, body) {
      const response = await send(method, absolute(path), body)
      return response.status === 204 ? null : response.json()
    },
    async paginate(path) {
      const items: unknown[] = []
      let next: string | undefined = absolute(path)
      for (let page = 0; next !== undefined && page < 100; page++) {
        const response = await send('GET', next)
        items.push(...arr(await response.json(), path))
        next = nextLink(response.headers.get('link'))
        if (next !== undefined && !next.startsWith(`${api}/`)) {
          throw new Error(`Refusing to follow a pagination link off the API host: ${next}`)
        }
      }
      return items
    },
  }
}

export function nextLink(header: string | null): string | undefined {
  for (const part of header?.split(',') ?? []) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part)
    if (match?.[1] !== undefined) return match[1]
  }
  return undefined
}

export function parseComments(items: readonly unknown[]): IssueComment[] {
  return items.map((item, i) => ({
    id: num(field(item, 'id'), `comments[${i}].id`),
    body: typeof field(item, 'body') === 'string' ? str(field(item, 'body'), 'body') : '',
    author: str(field(field(item, 'user'), 'login'), `comments[${i}].user.login`),
  }))
}

/** Creates the marked comment, or edits it if it exists (DOC-7). */
export async function upsertComment(
  client: GitHub,
  repository: string,
  issue: number,
  body: string,
  marker: string,
): Promise<'created' | 'updated'> {
  const comments = parseComments(
    await client.paginate(`/repos/${repository}/issues/${issue}/comments?per_page=100`),
  )
  const existing = findMarkedComment(comments, marker)
  if (existing === undefined) {
    await client.request('POST', `/repos/${repository}/issues/${issue}/comments`, { body })
    return 'created'
  }
  await client.request('PATCH', `/repos/${repository}/issues/comments/${existing.id}`, { body })
  return 'updated'
}

/** `owner/name`, checked, so it can go into an API path. */
export function checkRepository(value: string | undefined): string {
  if (value === undefined || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`Not a repository: ${String(value)}`)
  }
  return value
}
