// The mock database controls (PLY-21, PLY-34): reset to the seed, export the whole database to a
// file, and import one. An export holds the message history, so a rehearsal can be saved and
// loaded again as the starting point of the next demo. Every tab of the deployment shares the
// database (PLY-22), so each action applies to all of them.
import { Button, Dialog, DialogClose } from '@wrx/ui'
import { useEffect, useRef, useState } from 'react'

export interface MockControlsCoreProps {
  /** Resolves with an error message, or undefined when done. */
  readonly onReset: () => Promise<string | undefined>
  readonly onExport: () => Promise<
    { readonly ok: true; readonly json: string } | { readonly ok: false; readonly error: string }
  >
  readonly onImport: (json: string) => Promise<string | undefined>
  /** Saves the export as a file. Default: a download through an object URL. */
  readonly saveFile?: (name: string, json: string) => void
  /** For the file name; default the current time. */
  readonly now?: () => Date
}

type Status = { readonly tone: 'ok' | 'error'; readonly text: string } | undefined

function download(name: string, json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

export function MockControlsCore({
  onReset,
  onExport,
  onImport,
  saveFile = download,
  now = () => new Date(),
}: MockControlsCoreProps) {
  const [busy, setBusy] = useState<'reset' | 'export' | 'import' | undefined>(undefined)
  const [status, setStatus] = useState<Status>(undefined)
  const [confirming, setConfirming] = useState<'reset' | { readonly json: string } | undefined>()
  const fileInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = async (what: 'reset' | 'export' | 'import', task: () => Promise<Status>) => {
    setBusy(what)
    setStatus(undefined)
    const result = await task()
    if (!mounted.current) return
    setBusy(undefined)
    setStatus(result)
  }

  const reset = () =>
    run('reset', async () => {
      const error = await onReset()
      return error === undefined
        ? { tone: 'ok', text: 'The mock is back at its seed. Every pane and tab reconnects to it.' }
        : { tone: 'error', text: `Not reset: ${error}` }
    })

  const exportDb = () =>
    run('export', async () => {
      const result = await onExport()
      if (!result.ok) return { tone: 'error', text: `Not exported: ${result.error}` }
      const stamp = now().toISOString().slice(0, 19).replaceAll(':', '-')
      const name = `wrx-mock-database-${stamp}.json`
      saveFile(name, result.json)
      return { tone: 'ok', text: `Exported as ${name}.` }
    })

  const importDb = (json: string) =>
    run('import', async () => {
      const error = await onImport(json)
      return error === undefined
        ? { tone: 'ok', text: 'Imported. Every pane and tab reconnects to it.' }
        : { tone: 'error', text: `Not imported: ${error}` }
    })

  return (
    <div className="wrx-mock-controls" role="group" aria-label="Mock database">
      <span className="wrx-mock-controls__label">Mock database</span>
      <Button
        size="small"
        busy={busy === 'reset'}
        disabled={busy !== undefined}
        onClick={() => {
          setConfirming('reset')
        }}
      >
        Reset to seed…
      </Button>
      <Button
        size="small"
        busy={busy === 'export'}
        disabled={busy !== undefined}
        onClick={() => void exportDb()}
      >
        Export
      </Button>
      <Button
        size="small"
        busy={busy === 'import'}
        disabled={busy !== undefined}
        onClick={() => fileInput.current?.click()}
      >
        Import…
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="wrx-visually-hidden"
        aria-label="Mock database file to import"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file === undefined) return
          void file.text().then(
            (json) => {
              if (mounted.current) setConfirming({ json })
            },
            () => {
              if (mounted.current) setStatus({ tone: 'error', text: 'The file could not be read.' })
            },
          )
        }}
      />
      <span
        className={`wrx-mock-controls__status wrx-mock-controls__status--${status?.tone ?? 'ok'}`}
        role="status"
      >
        {status?.text}
      </span>
      <Dialog
        open={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined)
        }}
        title={confirming === 'reset' ? 'Reset the mock to its seed?' : 'Import this database?'}
        description={
          confirming === 'reset'
            ? 'Messages and changes since the seed are lost, in every tab of this browser. Export first to keep them.'
            : 'It replaces the whole mock database, in every tab of this browser. Export first to keep the current one.'
        }
        actions={
          <>
            <DialogClose>
              <Button>Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => {
                const pending = confirming
                setConfirming(undefined)
                if (pending === 'reset') void reset()
                else if (pending !== undefined) void importDb(pending.json)
              }}
            >
              {confirming === 'reset' ? 'Reset' : 'Import'}
            </Button>
          </>
        }
      />
    </div>
  )
}
