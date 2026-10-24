// The one bot comment on each PR (DOC-7). A hidden marker finds it again, so each push
// edits it in place instead of adding another. WP 0.7 adds screenshots as extra sections.

export const PREVIEW_MARKER = '<!-- wrx-site-preview -->'

/** The account GITHUB_TOKEN comments as. */
export const BOT_LOGIN = 'github-actions[bot]'

export interface IssueComment {
  readonly id: number
  readonly body: string
  readonly author: string
}

/** The bot's marked comment; the oldest if there are several. */
export function findMarkedComment(
  comments: readonly IssueComment[],
  marker = PREVIEW_MARKER,
): IssueComment | undefined {
  return [...comments]
    .sort((a, b) => a.id - b.id)
    .find((c) => c.author === BOT_LOGIN && c.body.includes(marker))
}

export interface PreviewDetails {
  readonly siteUrl: string
  readonly appUrl: string
  readonly sha: string
  /** One line from the size report (DOC-14). */
  readonly size?: string | undefined
  /** Extra Markdown sections, such as screenshots (DOC-19). */
  readonly sections?: readonly string[] | undefined
}

export function previewComment(details: PreviewDetails): string {
  return [
    PREVIEW_MARKER,
    '### Site preview',
    '',
    `- Site: ${details.siteUrl}`,
    `- App, on the mock backend: ${details.appUrl}`,
    `- Built from \`${details.sha.slice(0, 12)}\``,
    ...(details.size === undefined ? [] : [`- ${details.size}`]),
    '',
    'The whole site as it would be published, with the app on the mock backend only (DOC-6, DOC-12). This comment is updated on each push (DOC-7).',
    ...(details.sections ?? []).flatMap((section) => ['', section]),
    '',
  ].join('\n')
}

export function closedComment(merged: boolean, siteUrl: string): string {
  return [
    PREVIEW_MARKER,
    '### Site preview',
    '',
    merged
      ? `This PR was merged, so its preview is kept (DOC-8): ${siteUrl}`
      : 'This PR was closed without merging, so its preview has been removed (DOC-8).',
    '',
  ].join('\n')
}

export function failedComment(runUrl: string, siteUrl: string): string {
  return [
    PREVIEW_MARKER,
    '### Site preview',
    '',
    `The latest push was not deployed: the build or a site check failed. See ${runUrl}.`,
    '',
    `An earlier preview, if there is one, is still at ${siteUrl}.`,
    '',
    'A deny-list match (DOC-2) or a secret or real-server endpoint in the bundle (NFR-1, DOC-12) blocks the deploy until a person has reviewed it.',
    '',
  ].join('\n')
}
