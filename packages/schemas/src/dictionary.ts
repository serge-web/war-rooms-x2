import { z } from 'zod'
import type { CatalogueEntry } from './catalogue.ts'

type JsonSchema = z.core.JSONSchema.JSONSchema

interface FieldRow {
  readonly path: string
  readonly type: string
  readonly required: boolean
  readonly rules: string
  readonly description: string
}

/** Renders the data dictionary (DOC-3) as Markdown, from the schemas themselves. */
export function renderDictionary(entries: readonly CatalogueEntry[]): string {
  const lines = [
    '# Data dictionary',
    '',
    'Generated from the runtime schemas in `packages/schemas` (DOC-3). Do not edit by hand: run `pnpm dictionary`.',
    '',
    'Every document carries `schemaVersion`; clients migrate older versions on read and ignore payloads that fail validation (ARC-6, NFR-5).',
    '',
  ]
  for (const entry of entries) {
    const schema = z.toJSONSchema(entry.schema, { unrepresentable: 'any' })
    lines.push(`## ${entry.title}`, '')
    if (schema.description !== undefined) lines.push(`${schema.description}.`, '')
    lines.push(`- **Location:** ${entry.location}`, `- **Access:** ${entry.access}`, '')
    lines.push(
      '| Field | Type | Required | Rules | Description |',
      '| --- | --- | --- | --- | --- |',
    )
    for (const row of fieldRows(schema, '', true, entry.maxDepth ?? Infinity)) {
      lines.push(
        `| ${cell(`\`${row.path}\``)} | ${cell(row.type)} | ${row.required ? 'yes' : 'no'} | ${cell(row.rules)} | ${cell(row.description)} |`,
      )
    }
    lines.push('')
  }
  return lines.join('\n')
}

function fieldRows(
  schema: JsonSchema,
  path: string,
  required: boolean,
  depthLeft: number,
): FieldRow[] {
  const rows: FieldRow[] = []
  const variants = schema.oneOf ?? schema.anyOf
  const only = variants?.length === 1 ? variants[0] : undefined
  if (only !== undefined) {
    return fieldRows({ ...only, ...withoutVariants(schema) }, path, required, depthLeft)
  }
  if (path !== '') {
    rows.push({
      path,
      type: typeName(schema),
      required,
      rules: rules(schema),
      description: schema.description ?? '',
    })
  }
  if (depthLeft <= 0) return rows
  const props = schema.properties
  if (props !== undefined) {
    const requiredKeys = new Set(schema.required ?? [])
    for (const [key, child] of Object.entries(props)) {
      if (typeof child === 'boolean') continue
      rows.push(
        ...fieldRows(
          child,
          path === '' ? key : `${path}.${key}`,
          requiredKeys.has(key),
          depthLeft - 1,
        ),
      )
    }
  }
  const items = schema.items
  if (items !== undefined && typeof items !== 'boolean' && !Array.isArray(items)) {
    if (items.properties !== undefined) rows.push(...fieldRows(items, `${path}[]`, true, depthLeft))
  }
  const values = schema.additionalProperties
  if (values !== undefined && typeof values !== 'boolean' && values.properties !== undefined) {
    rows.push(...fieldRows(values, `${path}.<key>`, true, depthLeft))
  }
  return rows
}

function withoutVariants(schema: JsonSchema): JsonSchema {
  const { oneOf: _oneOf, anyOf: _anyOf, ...rest } = schema
  return rest
}

function typeName(schema: JsonSchema): string {
  if (schema.const !== undefined) return 'constant'
  if (schema.enum !== undefined) return 'enum'
  if (schema.not !== undefined && Object.keys(schema).length <= 2) return 'never'
  const type = Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type
  if (type === 'array') {
    const items = schema.items
    const inner =
      items !== undefined && typeof items !== 'boolean' && !Array.isArray(items)
        ? typeName(items)
        : 'any'
    return `array of ${inner}`
  }
  if (
    type === 'object' &&
    schema.properties === undefined &&
    schema.additionalProperties !== undefined
  ) {
    const values = schema.additionalProperties
    return `map of ${typeof values === 'boolean' || Object.keys(values).length === 0 ? 'any' : typeName(values)}`
  }
  return type ?? 'any'
}

function rules(schema: JsonSchema): string {
  const out: string[] = []
  if (schema.const !== undefined) out.push(`= ${JSON.stringify(schema.const)}`)
  if (schema.enum !== undefined)
    out.push(`one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`)
  if (schema.not !== undefined && typeName(schema) === 'never') out.push('must be absent')
  if (schema.minLength !== undefined) out.push(`length ≥ ${schema.minLength}`)
  if (schema.maxLength !== undefined) out.push(`length ≤ ${schema.maxLength}`)
  if (schema.minimum !== undefined) out.push(`≥ ${schema.minimum}`)
  if (schema.maximum !== undefined && schema.maximum < Number.MAX_SAFE_INTEGER) {
    out.push(`≤ ${schema.maximum}`)
  }
  if (schema.minItems !== undefined) out.push(`items ≥ ${schema.minItems}`)
  if (schema.maxItems !== undefined) out.push(`items ≤ ${schema.maxItems}`)
  if (schema.format !== undefined) out.push(`format ${schema.format}`)
  if (schema.contentEncoding !== undefined) out.push(`encoding ${schema.contentEncoding}`)
  if (
    schema.pattern !== undefined &&
    schema.format === undefined &&
    schema.contentEncoding === undefined
  ) {
    out.push(`pattern \`${schema.pattern}\``)
  }
  return out.join('; ')
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ')
}
