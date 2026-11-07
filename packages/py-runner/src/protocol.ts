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
  /**
   * Import the SDK (and so pydantic) before `ready`, after the lockdown: the worker's own step,
   * no script's, so the run it serves starts with the SDK loaded and nothing else (M1).
   */
  readonly preimportSdk: boolean
}

export interface RunMessage {
  readonly kind: 'run'
  readonly runId: number
  readonly code: string
}

export interface ReplyMessage {
  readonly kind: 'reply'
  readonly callId: number
  /** The bridge protocol's reply, as JSON text. */
  readonly result: string
}

/** An event for a run's subscriptions (WP 6.4): the protocol's `bridgeEventSchema`, as JSON. */
export interface EventMessage {
  readonly kind: 'event'
  readonly runId: number
  readonly event: string
}

export type ToWorker = InitMessage | RunMessage | ReplyMessage | EventMessage

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
    /** ms to import the SDK before `ready` (`preimportSdk`); 0 when not asked. */
    importSdk: z.number(),
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
  // The script itself starts: its packages are loaded, its code runs next. The run's time limit
  // (PY-10) counts from here, not from the worker's start (WP 6.4).
  z.object({ kind: z.literal('started'), runId: z.number().int() }).strict(),
  z
    .object({
      kind: z.literal('output'),
      runId: z.number().int(),
      /** Which stream printed it (WP 6.3); absent means stdout. */
      stream: z.enum(['stdout', 'stderr']).optional(),
      text: z.string().max(MAX_TEXT),
    })
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
