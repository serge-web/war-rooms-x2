import { describe, expect, it } from 'vitest'
import {
  BOT_LOGIN,
  PREVIEW_MARKER,
  closedComment,
  failedComment,
  findMarkedComment,
  previewComment,
} from './comment.ts'

describe('previewComment (DOC-7)', () => {
  const body = previewComment({
    siteUrl: 'https://serge-web.github.io/war-rooms-x2/pr/7/',
    appUrl: 'https://serge-web.github.io/war-rooms-x2/pr/7/app/',
    sha: '0123456789abcdef0123456789abcdef01234567',
    size: 'Size: 7.10 MB, 0.7% of the 1.00 GB Pages limit',
    sections: ['#### Screenshots\n\n(none)'],
  })
  it('starts with the hidden marker', () => {
    expect(body.startsWith(PREVIEW_MARKER)).toBe(true)
  })
  it('links the site and the app, and names the commit', () => {
    expect(body).toContain('- Site: https://serge-web.github.io/war-rooms-x2/pr/7/')
    expect(body).toContain(
      '- App, on the mock backend: https://serge-web.github.io/war-rooms-x2/pr/7/app/',
    )
    expect(body).toContain('`0123456789ab`')
    expect(body).toContain('- Size: 7.10 MB')
  })
  it('appends extra sections, such as screenshots (DOC-19)', () => {
    expect(body).toMatch(/updated on each push \(DOC-7\)\.\n\n#### Screenshots/)
  })
})

describe('closed and failed comments', () => {
  it('says whether the preview was kept (DOC-8)', () => {
    expect(closedComment(true, 'https://x/pr/7/')).toContain('merged, so its preview is kept')
    expect(closedComment(false, 'https://x/pr/7/')).toContain('has been removed')
    expect(closedComment(false, 'https://x/pr/7/')).not.toContain('https://x/pr/7/')
  })
  it('keeps the marker, so the same comment is edited', () => {
    expect(closedComment(true, 'u').startsWith(PREVIEW_MARKER)).toBe(true)
    expect(failedComment('https://run', 'u').startsWith(PREVIEW_MARKER)).toBe(true)
  })
})

describe('findMarkedComment', () => {
  it("finds the bot's oldest marked comment and ignores people quoting it", () => {
    const comments = [
      { id: 30, author: BOT_LOGIN, body: `${PREVIEW_MARKER}\nlater` },
      { id: 10, author: 'IanMayo', body: `> ${PREVIEW_MARKER}` },
      { id: 20, author: BOT_LOGIN, body: `${PREVIEW_MARKER}\nfirst` },
      { id: 5, author: BOT_LOGIN, body: 'CI passed' },
    ]
    expect(findMarkedComment(comments)?.id).toBe(20)
    expect(findMarkedComment(comments.filter((c) => c.id !== 20 && c.id !== 30))).toBeUndefined()
  })
})
