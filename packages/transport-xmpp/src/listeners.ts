import type { Unsubscribe } from '@wrx/transport'

/** Callbacks grouped by key (a room, a node), each removable by the Unsubscribe it returns. */
export class Listeners<K, E> {
  private readonly byKey = new Map<K, Set<(event: E) => void>>()

  add(key: K, listener: (event: E) => void): Unsubscribe {
    const set = this.byKey.get(key) ?? new Set()
    set.add(listener)
    this.byKey.set(key, set)
    return () => {
      set.delete(listener)
      if (set.size === 0 && this.byKey.get(key) === set) this.byKey.delete(key)
    }
  }

  emit(key: K, event: E): void {
    for (const listener of [...(this.byKey.get(key) ?? [])]) listener(event)
  }

  has(key: K): boolean {
    return (this.byKey.get(key)?.size ?? 0) > 0
  }

  clear(): void {
    this.byKey.clear()
  }
}
