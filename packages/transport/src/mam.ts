// XEP-0313 Message Archive Management, paged with XEP-0059 Result Set Management.
import type { Outcome } from './errors.ts'
import type { RoomJid, RoomMessage } from './muc.ts'

export interface MamQuery {
  /**
   * Page backwards from before this archive id; omit for the latest page (PLY-49). The ids are
   * the `stanzaId`s of earlier results.
   */
  readonly before?: string
  /** Page size; the server may return fewer. */
  readonly max: number
}

export interface MamPage {
  /** Oldest first. */
  readonly messages: readonly RoomMessage[]
  /** RSM `first`: pass as `before` to fetch the previous page. */
  readonly first: string | undefined
  readonly last: string | undefined
  /** No older messages remain. */
  readonly complete: boolean
}

export interface MamApi {
  /** Queries a room's archive. Needs current membership; fails `forbidden` otherwise. */
  queryRoom(room: RoomJid, query: MamQuery): Outcome<MamPage>
}
