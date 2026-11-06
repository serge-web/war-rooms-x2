// The messages between the page and the script worker (PY-4), from S17. Only strings and plain
// numbers cross: the worker's Python never holds a proxy of a page object, and the page parses
// every message it gets from the worker as untrusted input (a script that escaped its sandbox
// could post anything). The SDK operations themselves are in sdk-ops.ts.
import { z } from 'zod'

export interface InitMessage {
  readonly kind: 'init'
  /** Absolute URL of the folder holding pyodide.mjs and the packages, with a trailing slash. */
  readonly indexURL: string
  /** Packages to load before the first run (lock-file names). */
  readonly packages: readonly string[]
}

export interface RunMessage {
  readonly kind: 'run'
  readonly runId: number
  readonly code: string
  /** JSON: what the script may know about where it runs (role, room ids); data, not access. */
  readonly context: string
}

export interface ReplyMessage {
  readonly kind: 'reply'
  readonly callId: number
  /** JSON of a `CallResult`. */
  readonly result: string
}

export type ToWorker = InitMessage | RunMessage | ReplyMessage

/** The most a call's payload may be: the world state's cap (500 KB) with room for JSON. */
export const MAX_PAYLOAD_CHARS = 1_000_000
const MAX_TEXT = 100_000
const MAX_ERROR = 10_000

const timingsSchema = z
  .object({
    /** ms from the worker's first line to `loadPyodide` resolving. */
    loadPyodide: z.number(),
    /** ms to load the packages named in `init`. */
    loadPackages: z.number(),
    /** Bytes of the interpreter's WebAssembly memory. */
    wasmMemory: z.number(),
  })
  .strict()
export type Timings = z.infer<typeof timingsSchema>

/** The worker's messages, as the page validates them. */
export const fromWorkerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hello') }).strict(),
  z.object({ kind: z.literal('ready'), timings: timingsSchema }).strict(),
  z.object({ kind: z.literal('init-failed'), error: z.string().max(MAX_ERROR) }).strict(),
  z
    .object({
      kind: z.literal('call'),
      runId: z.number().int(),
      callId: z.number().int(),
      op: z.string().max(100),
      payload: z.string().max(MAX_PAYLOAD_CHARS),
    })
    .strict(),
  z
    .object({ kind: z.literal('output'), runId: z.number().int(), text: z.string().max(MAX_TEXT) })
    .strict(),
  z
    .object({
      kind: z.literal('done'),
      runId: z.number().int(),
      ok: z.boolean(),
      error: z.string().max(MAX_ERROR).optional(),
      ms: z.number(),
      importsMs: z.number().optional(),
      wasmMemory: z.number(),
    })
    .strict(),
])
export type FromWorker = z.infer<typeof fromWorkerSchema>
