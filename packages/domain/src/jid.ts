// Small JID helpers. JIDs arrive from the network, so nothing here throws.

/** `local@domain/resource` → `local@domain`. */
export function bareJid(jid: string): string {
  const slash = jid.indexOf('/')
  return (slash < 0 ? jid : jid.slice(0, slash)).toLowerCase()
}

/** The local part of a JID, or `undefined` when it has none. */
export function localpart(jid: string): string | undefined {
  const bare = bareJid(jid)
  const at = bare.indexOf('@')
  return at <= 0 ? undefined : bare.slice(0, at)
}

/** The domain part of a JID. */
export function domainpart(jid: string): string {
  const bare = bareJid(jid)
  return bare.slice(bare.indexOf('@') + 1)
}

/** The room id in `<roomId>@<muc service>`. */
export function roomJid(roomId: string, mucService: string): string {
  return `${roomId}@${mucService}`
}
