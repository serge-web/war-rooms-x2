import { describe, expect, it } from 'vitest'
import { CATALOGUE } from './catalogue.ts'
import { renderDictionary } from './dictionary.ts'
import { DOCUMENT_SCHEMAS } from './parse.ts'

describe('data dictionary (DOC-3)', () => {
  const markdown = renderDictionary(CATALOGUE)

  it('documents every network payload', () => {
    const catalogued = new Set(CATALOGUE.map((e) => e.schema))
    const documented = Object.entries(DOCUMENT_SCHEMAS).filter(
      // The message union is documented by its members.
      ([kind, schema]) => kind !== 'message' && !catalogued.has(schema),
    )
    expect(documented).toEqual([])
  })

  it('lists fields with their rules', () => {
    expect(markdown).toContain('| `colour` | string | yes | pattern `^#[0-9a-fA-F]{6}$` |')
    expect(markdown).toContain('| `participants[].access` | enum | yes | one of "write", "read" |')
    expect(markdown).toContain('| `content.text` | string | yes | length ≥ 1; length ≤ 8000 |')
  })

  it('shows nested design file fields only one level deep', () => {
    const design = markdown.slice(markdown.indexOf('## Design file'))
    expect(design).toContain('| `roles` | array of object |')
    expect(design).not.toContain('`roles[].id`')
  })

  it('keeps every table row at five columns', () => {
    const rows = markdown.split('\n').filter((line) => line.startsWith('|'))
    const bad = rows.filter((line) => line.replaceAll('\\|', '').split('|').length !== 7)
    expect(bad).toEqual([])
  })
})
