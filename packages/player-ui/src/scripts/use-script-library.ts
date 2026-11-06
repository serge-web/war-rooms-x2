// The account's scripts in React (PD5, PY-7; WP 6.3): loaded from private storage, re-read every
// few seconds while the panel is shown, and written through `saveScripts`' version check. Another
// session's save is taken at once when this one has no unsaved edits; otherwise the panel is told
// (`elsewhere`) and the user chooses. A write refused by the check (`conflict`) keeps the change
// that was refused, so "Keep my change" can apply it again to what the other session saved.
import { loadScripts, saveScripts } from '@wrx/domain/scripts'
import type { PrivateStore, ScriptsEdit, StoredScripts } from '@wrx/domain/scripts'
import { useCallback, useEffect, useRef, useState } from 'react'

/** A change to the scripts, applied to the latest stored ones. */
export type ScriptsChange = (scripts: StoredScripts) => ScriptsEdit

export interface ScriptLibrary {
  /** `loading` until the first read, `error` if it failed (nothing can be saved then). */
  readonly status: 'loading' | 'ready' | 'error'
  readonly scripts: StoredScripts | undefined
  /** Why the scripts could not be read. */
  readonly loadError: string | undefined
  /** A write is in flight. */
  readonly saving: boolean
  /** Why the last change was not saved, other than a conflict. */
  readonly saveError: string | undefined
  /** Another session saved first: the last change was not written. */
  readonly conflict: boolean
  /** Another session saved while this one had unsaved edits: they were not reloaded. */
  readonly elsewhere: boolean
  /** A polite note of what just happened, e.g. a reload from another session. */
  readonly note: string | undefined
  /** Applies a change and saves it; resolves true if it was saved. */
  readonly commit: (change: ScriptsChange) => Promise<boolean>
  /** Takes what is stored now, dropping a refused change. */
  readonly reload: () => Promise<void>
  /** Applies the refused change again, to what the other session saved. */
  readonly keepMine: () => Promise<boolean>
  readonly dismissElsewhere: () => void
}

export interface ScriptLibraryOptions {
  /** How often the stored scripts are re-read (ms). Default 5 s; 0 turns it off. */
  readonly pollMs?: number
  /** Whether this session has unsaved edits: a newer store is then not taken silently. */
  readonly hasUnsavedEdits: () => boolean
  /** Called when a newer store replaced the one shown, e.g. to drop editor buffers. */
  readonly onReplaced?: (scripts: StoredScripts) => void
  readonly now?: () => string
}

export function useScriptLibrary(
  store: PrivateStore,
  options: ScriptLibraryOptions,
): ScriptLibrary {
  const { pollMs = 5_000 } = options
  const [scripts, setScripts] = useState<StoredScripts | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  const [refused, setRefused] = useState<ScriptsChange | undefined>(undefined)
  const [elsewhere, setElsewhere] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)
  const current = useRef<StoredScripts | undefined>(undefined)
  const busy = useRef(false)
  /** Read through a function: a write may start while a read is awaited. */
  const isBusy = () => busy.current
  /** The newer revision another session saved while this one had unsaved edits. */
  const newer = useRef<number | undefined>(undefined)
  /** A newer revision the user chose to keep editing over: not announced again. */
  const ignored = useRef<number | undefined>(undefined)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const adopt = useCallback((next: StoredScripts) => {
    const replacing = current.current !== undefined && current.current.revision !== next.revision
    current.current = next
    setScripts(next)
    if (replacing) optionsRef.current.onReplaced?.(next)
  }, [])

  // The first read, and the poll.
  useEffect(() => {
    let live = true
    const read = async (first: boolean) => {
      if (isBusy()) return
      const loaded = await loadScripts(store)
      if (!live || isBusy()) return
      if (!loaded.ok) {
        if (first || current.current === undefined) setLoadError(loaded.error)
        return
      }
      setLoadError(undefined)
      const known = current.current
      if (known === undefined) {
        adopt(loaded.value)
        return
      }
      if (loaded.value.revision === known.revision) return
      if (optionsRef.current.hasUnsavedEdits()) {
        newer.current = loaded.value.revision
        if (loaded.value.revision !== ignored.current) setElsewhere(true)
        return
      }
      adopt(loaded.value)
      setElsewhere(false)
      setNote('The scripts were updated from another session of this login.')
    }
    void read(true)
    if (pollMs <= 0)
      return () => {
        live = false
      }
    const timer = setInterval(() => {
      void read(false)
    }, pollMs)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [store, pollMs, adopt])

  const save = useCallback(
    async (change: ScriptsChange, base: StoredScripts): Promise<boolean> => {
      const edited = change(base)
      if (!edited.ok) {
        setSaveError(edited.error)
        return false
      }
      busy.current = true
      setSaving(true)
      setSaveError(undefined)
      setNote(undefined)
      try {
        const outcome = await saveScripts(store, edited.value, base.revision, {
          now: optionsRef.current.now?.() ?? new Date().toISOString(),
        })
        if (outcome.status === 'saved') {
          current.current = outcome.scripts
          setScripts(outcome.scripts)
          setRefused(undefined)
          setElsewhere(false)
          return true
        }
        if (outcome.status === 'conflict') {
          setRefused(() => change)
          return false
        }
        setSaveError(outcome.error)
        return false
      } finally {
        busy.current = false
        setSaving(false)
      }
    },
    [store],
  )

  const commit = useCallback(
    (change: ScriptsChange) => {
      const base = current.current
      if (base === undefined || busy.current) return Promise.resolve(false)
      return save(change, base)
    },
    [save],
  )

  const reload = useCallback(async () => {
    busy.current = true
    try {
      const loaded = await loadScripts(store)
      if (!loaded.ok) {
        setSaveError(`The scripts could not be reloaded: ${loaded.error}.`)
        return
      }
      current.current = loaded.value
      setScripts(loaded.value)
      optionsRef.current.onReplaced?.(loaded.value)
      setRefused(undefined)
      setElsewhere(false)
      setSaveError(undefined)
      setNote('Reloaded the scripts as they are stored now.')
    } finally {
      busy.current = false
    }
  }, [store])

  const keepMine = useCallback(async () => {
    const change = refused
    if (change === undefined) return false
    const loaded = await loadScripts(store)
    if (!loaded.ok) {
      setSaveError(`The scripts could not be read again: ${loaded.error}.`)
      return false
    }
    // Their save is taken as the base, without dropping this session's editor buffers.
    current.current = loaded.value
    setScripts(loaded.value)
    return save(change, loaded.value)
  }, [refused, save, store])

  return {
    status: scripts !== undefined ? 'ready' : loadError !== undefined ? 'error' : 'loading',
    scripts,
    loadError,
    saving,
    saveError,
    conflict: refused !== undefined,
    elsewhere,
    note,
    commit,
    reload,
    keepMine,
    dismissElsewhere: () => {
      ignored.current = newer.current
      setElsewhere(false)
    },
  }
}
