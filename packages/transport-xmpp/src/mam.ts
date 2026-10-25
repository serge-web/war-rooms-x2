// XEP-0313 Message Archive Management for rooms, paged backwards with XEP-0059 RSM.
import type { MamApi, MamPage, MamQuery, Outcome, RoomJid, RoomMessage } from '@wrx/transport'
import { JID } from 'stanza'
import type { Core } from './core.ts'

export class XmppMam implements MamApi {
  constructor(private readonly core: Core) {}

  queryRoom(room: RoomJid, query: MamQuery): Outcome<MamPage> {
    return this.core.run(async () => {
      // XEP-0059 §2.5: an empty <before/> asks for the last page.
      const fin = await this.core.client.searchHistory(room, {
        paging: { max: query.max, before: query.before ?? '' },
      })
      const messages: RoomMessage[] = []
      // Use the results collected on the fin, not mam:item listeners (WP 0.3).
      for (const result of fin.results ?? []) {
        const message = result.item.message
        const stamp = result.item.delay?.timestamp
        const nick = JID.getResource(message?.from)
        if (message?.body === undefined || stamp === undefined || nick === undefined) continue
        const muc = message.muc
        // §5.1.3 (XEP-0313) for groupchat: the archive id is the stanza-id the room stamped.
        messages.push({
          room,
          stanzaId: result.id,
          nick,
          from:
            muc !== undefined && muc.type !== 'direct-invite' && muc.jid !== undefined
              ? JID.toBare(muc.jid)
              : undefined,
          timestamp: stamp.toISOString(),
          body: message.body,
        })
      }
      return {
        messages,
        first: fin.paging?.first,
        last: fin.paging?.last,
        complete: fin.complete === true,
      }
    })
  }
}
