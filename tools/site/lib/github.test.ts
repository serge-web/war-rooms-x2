import { describe, expect, it } from 'vitest'
import { BOT_LOGIN, PREVIEW_MARKER } from './comment.ts'
import type { FetchLike, FetchResponse } from './github.ts'
import { GitHubError, checkRepository, gitHub, nextLink, upsertComment } from './github.ts'

interface Call {
  readonly method: string
  readonly url: string
  readonly body?: unknown
}

/** A fake API: responses by `METHOD url`, recording every call. */
function fakeApi(routes: Record<string, { status?: number; json: unknown; link?: string }>) {
  const calls: Call[] = []
  const fetch: FetchLike = (url, init) => {
    calls.push({
      method: init.method,
      url,
      ...(init.body === undefined ? {} : { body: JSON.parse(init.body) as unknown }),
    })
    const route = routes[`${init.method} ${url}`]
    const status = route?.status ?? (route === undefined ? 404 : 200)
    const response: FetchResponse = {
      ok: status < 400,
      status,
      headers: { get: (name) => (name === 'link' ? (route?.link ?? null) : null) },
      json: () => Promise.resolve(route?.json ?? null),
      text: () => Promise.resolve(JSON.stringify(route?.json ?? 'not found')),
    }
    return Promise.resolve(response)
  }
  return { fetch, calls }
}

const API = 'https://api.github.com'
const REPO = 'serge-web/war-rooms-x2'
const COMMENTS = `${API}/repos/${REPO}/issues/7/comments?per_page=100`

describe('nextLink', () => {
  it('finds rel="next"', () => {
    expect(
      nextLink(
        '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"',
      ),
    ).toBe('https://api.github.com/x?page=2')
    expect(nextLink('<https://api.github.com/x?page=1>; rel="prev"')).toBeUndefined()
    expect(nextLink(null)).toBeUndefined()
  })
})

describe('paginate', () => {
  it('follows next links and concatenates pages', async () => {
    const { fetch } = fakeApi({
      [`GET ${API}/items`]: { json: [1, 2], link: `<${API}/items?page=2>; rel="next"` },
      [`GET ${API}/items?page=2`]: { json: [3] },
    })
    expect(await gitHub({ token: 't', fetch }).paginate('/items')).toEqual([1, 2, 3])
  })
  it('refuses to follow a link off the API host', async () => {
    const { fetch } = fakeApi({
      [`GET ${API}/items`]: { json: [1], link: '<https://evil.example/items>; rel="next"' },
    })
    await expect(gitHub({ token: 't', fetch }).paginate('/items')).rejects.toThrow(
      /off the API host/,
    )
  })
  it('reports the status of a failed call', async () => {
    const { fetch } = fakeApi({})
    const error: unknown = await gitHub({ token: 't', fetch })
      .request('GET', '/missing')
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GitHubError)
    expect((error as GitHubError).status).toBe(404)
  })
})

describe('upsertComment (DOC-7)', () => {
  it('creates the comment when there is none', async () => {
    const { fetch, calls } = fakeApi({
      [`GET ${COMMENTS}`]: { json: [{ id: 1, body: 'hi', user: { login: 'IanMayo' } }] },
      [`POST ${API}/repos/${REPO}/issues/7/comments`]: { status: 201, json: {} },
    })
    const outcome = await upsertComment(
      gitHub({ token: 't', fetch }),
      REPO,
      7,
      'body',
      PREVIEW_MARKER,
    )
    expect(outcome).toBe('created')
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      url: `${API}/repos/${REPO}/issues/7/comments`,
      body: { body: 'body' },
    })
  })
  it('edits the marked comment in place, found on a later page', async () => {
    const { fetch, calls } = fakeApi({
      [`GET ${COMMENTS}`]: {
        json: [{ id: 1, body: 'hi', user: { login: 'IanMayo' } }],
        link: `<${COMMENTS}&page=2>; rel="next"`,
      },
      [`GET ${COMMENTS}&page=2`]: {
        json: [{ id: 99, body: `${PREVIEW_MARKER}\nold`, user: { login: BOT_LOGIN } }],
      },
      [`PATCH ${API}/repos/${REPO}/issues/comments/99`]: { json: {} },
    })
    const outcome = await upsertComment(
      gitHub({ token: 't', fetch }),
      REPO,
      7,
      'new',
      PREVIEW_MARKER,
    )
    expect(outcome).toBe('updated')
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([
      { method: 'PATCH', url: `${API}/repos/${REPO}/issues/comments/99`, body: { body: 'new' } },
    ])
  })
})

describe('checkRepository', () => {
  it('accepts owner/name only', () => {
    expect(checkRepository('serge-web/war-rooms-x2')).toBe('serge-web/war-rooms-x2')
    expect(() => checkRepository('a/b/c')).toThrow()
    expect(() => checkRepository(undefined)).toThrow()
  })
})
