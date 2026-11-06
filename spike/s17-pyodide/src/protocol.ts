// The messages between the page and the script worker (PY-4). Only strings and plain numbers
// cross: the worker's Python never holds a proxy of a page object, and the page parses every
// message it gets from the worker as untrusted input (a script that escaped its sandbox could
// post anything).
import { z } from 'zod'

/** The SDK's operations, all the bridge offers (Annex C PY-2, the slice S17 needs). */
export const BRIDGE_OPS = Object.freeze([
  'readWorldState',
  'readRoomMessages',
  'writeDraft',
  'postProposal',
] as const)
export type BridgeOp = (typeof BRIDGE_OPS)[number]

export interface InitMessage {
  readonly kind: 'init'
  /** Absolute URL of the folder holding pyodide.mjs and the packages, with a trailing slash. */
  readonly indexURL: string
  /** Packages to load before the first run (lock-file names). */
  readonly packages: readonly string[]
  /** Remove the network, storage and messaging globals before any script runs. */
  readonly lockdown: boolean
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
  /** JSON: `{ok: true, value}` or `{ok: false, error}`. */
  readonly result: string
}

export type ToWorker = InitMessage | RunMessage | ReplyMessage

export interface Timings {
  /** ms from the worker's first line to `loadPyodide` resolving. */
  readonly loadPyodide: number
  /** ms to load `packages`. */
  readonly loadPackages: number
  /** Bytes of the interpreter's WebAssembly memory. */
  readonly wasmMemory: number
}

/** The worker's messages, as the page validates them. */
export const fromWorkerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ready'),
    timings: z.object({
      loadPyodide: z.number(),
      loadPackages: z.number(),
      wasmMemory: z.number(),
    }),
  }),
  z.object({ kind: z.literal('hello') }),
  z.object({ kind: z.literal('init-failed'), error: z.string().max(10_000) }),
  z.object({
    kind: z.literal('call'),
    runId: z.number().int(),
    callId: z.number().int(),
    op: z.string().max(100),
    payload: z.string().max(1_000_000),
  }),
  z.object({ kind: z.literal('output'), runId: z.number().int(), text: z.string().max(100_000) }),
  z.object({
    kind: z.literal('done'),
    runId: z.number().int(),
    ok: z.boolean(),
    error: z.string().max(10_000).optional(),
    ms: z.number(),
    importsMs: z.number().optional(),
    wasmMemory: z.number(),
  }),
])
export type FromWorker = z.infer<typeof fromWorkerSchema>
