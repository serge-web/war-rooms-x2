// The raw editor's text (WP 4.3, TPL-7): a template's schema and UI schema as one JSON document,
// `{"schema": …, "uiSchema": …}`, so a profile issue's path (`schema.properties.x.maxLength`)
// is a path in the text. Pure: parsing, profile issues and where each lies.
import { checkTemplateProfile, profilePath } from '@wrx/schemas'
import type { ProfileIssue } from '@wrx/schemas'
import { jsonSpans, rangeOf } from './jsonPaths.ts'

export interface RawTemplate {
  readonly schema: Record<string, unknown>
  readonly uiSchema: Record<string, unknown> | undefined
}

export type RawParse =
  | { readonly ok: true; readonly value: RawTemplate }
  | { readonly ok: false; readonly error: string }

/** The text the raw editor starts from. */
export function rawText(template: {
  readonly schema: unknown
  readonly uiSchema?: unknown
}): string {
  return `${JSON.stringify(
    template.uiSchema === undefined
      ? { schema: template.schema }
      : { schema: template.schema, uiSchema: template.uiSchema },
    null,
    2,
  )}\n`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The schema and UI schema in the text, or why there are none. Only the shape is checked here
 * (an object with an object `schema` and, if any, an object `uiSchema`); the profile is
 * checked by `rawIssues`, and the draft takes any such template, so switching to the builder
 * or reloading keeps it while it is being fixed.
 */
export function parseRaw(text: string): RawParse {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      error: `not JSON: ${error instanceof Error ? error.message : 'unreadable'}`,
    }
  }
  if (!isObject(json)) return { ok: false, error: 'must be an object with "schema"' }
  for (const key of Object.keys(json)) {
    if (key !== 'schema' && key !== 'uiSchema') {
      return { ok: false, error: `"${key}" is not "schema" or "uiSchema"` }
    }
  }
  const { schema, uiSchema } = json
  if (!isObject(schema)) return { ok: false, error: '"schema" must be a JSON Schema object' }
  if (uiSchema !== undefined && !isObject(uiSchema)) {
    return { ok: false, error: '"uiSchema" must be an object' }
  }
  return { ok: true, value: { schema, uiSchema } }
}

export interface RawIssue {
  readonly from: number
  readonly to: number
  readonly message: string
}

/** The profile issues of the text's template, each with the text range it concerns. */
export function rawIssues(text: string): RawIssue[] {
  const parsed = parseRaw(text)
  if (!parsed.ok) return []
  const spans = jsonSpans(text)
  if (spans === undefined) return []
  return checkTemplateProfile(parsed.value.schema, parsed.value.uiSchema).map(
    (issue: ProfileIssue) => ({
      ...rangeOf(spans, issue.path),
      message: `${profilePath(issue)}: ${issue.message}`,
    }),
  )
}
