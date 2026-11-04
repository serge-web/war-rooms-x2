// Results: one JSON line per observation (results/observations.jsonl), and stanza files.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG, DB, S14_ROOT } from './config.ts'
import type { Transcript } from './pubsub.ts'

const started = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)

/** This run's id: scripts/run.ts's start time (S14_RUN), shared by every step it starts. */
export const runId = () => process.env.S14_RUN ?? started

/** One JSON line per observation, tagged with the run, the config and the database. */
export function observe(check: string, name: string, data: Record<string, unknown>): void {
  const dir = join(S14_ROOT, 'results')
  mkdirSync(dir, { recursive: true })
  // Read the environment at call time: scripts/run.ts sets S14_CONFIG after its imports.
  const config = process.env.S14_CONFIG ?? CONFIG
  const db = process.env.S14_DB ?? (process.env.S14_CONFIG === undefined ? DB : config)
  const line = JSON.stringify({ run: runId(), config, db, check, name, ...data })
  appendFileSync(join(dir, 'observations.jsonl'), line + '\n')
}

/** Writes stanzas/<config>-<name>.xml (long runs of base64 elided). */
export function saveStanzas(name: string, t: Transcript, config: string = CONFIG): void {
  const dir = join(S14_ROOT, 'stanzas')
  mkdirSync(dir, { recursive: true })
  const text = t.lines
    .map((l) =>
      l
        .replace(/<(auth|challenge|response|success)\b([^>]*)>[^<]*<\/\1>/g, '<$1$2>[sasl payload removed]</$1>')
        .replace(/(s14-[0-9a-z]+-[0-9a-z]{5})/g, 'RUN'),
    )
    .join('\n\n')
  writeFileSync(join(dir, `${config}-${name}.xml`), text + '\n')
}
