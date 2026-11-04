// Results: one JSON line per observation (results/observations.jsonl), and stanza files.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG, ROOT } from './config.ts'
import type { Transcript } from '../../s14/src/pubsub.ts'

const started = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)

/** This run's id: scripts/run.ts's start time (S1516_RUN), shared by every step it starts. */
export const runId = () => process.env.S1516_RUN ?? started

/** One JSON line per observation, tagged with the run and the config. */
export function observe(check: string, name: string, data: Record<string, unknown>): void {
  const dir = join(ROOT, 'results')
  mkdirSync(dir, { recursive: true })
  const config = process.env.S1516_CONFIG ?? CONFIG
  const line = JSON.stringify({ run: runId(), config, check, name, ...data })
  appendFileSync(join(dir, 'observations.jsonl'), line + '\n')
}

/** Run tokens are replaced by RUN, SASL payloads removed, long bodies elided. */
export function scrub(xml: string): string {
  return xml
    .replace(/<(auth|challenge|response|success)\b([^>]*)>[^<]*<\/\1>/g, '<$1$2>[sasl payload removed]</$1>')
    .replace(/(s1516-[0-9a-z]+-[0-9a-z]{5})/g, 'RUN')
    .replace(/x{200,}/g, (m) => `[${m.length} × 'x']`)
}

/** Writes stanzas/<config>-<name>.xml. */
export function saveStanzas(name: string, t: Transcript, config: string = CONFIG): void {
  const dir = join(ROOT, 'stanzas')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${config}-${name}.xml`), t.lines.map(scrub).join('\n\n') + '\n')
}
