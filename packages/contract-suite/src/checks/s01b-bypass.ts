// S01b observer bypass probes (R1): other ways the observer might put content in front of the
// room. Port of spike S01b-read-only-bypass.test.ts. Tagged `r1`. Each probe is sent from the
// observer's own session and must reach nobody; the probes for channels the transport interface
// does not offer send raw stanzas (tag `raw`, needs RawAccess).
import type { Session } from '@wrx/transport'
import type { RoomMessage } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { GAME_ROOM } from '../fixture.ts'
import { errorOf, json, must, record, sleep, uniq } from '../harness.ts'
import type { RawAccess } from '../suite.ts'

const QUIET_MS = 1_500

export function s01b(ctx: Ctx, raw: RawAccess | undefined): void {
  describe('S01b observer bypass probes (R1)', { tags: ['r1'] }, () => {
    // XEP-0045 §7.4 and §7.2.1: only occupants may post; a member who has not joined is refused.
    it('groupchat without joining is refused with not-acceptable and not delivered', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.blueHq)
      const co = await ctx.login(fx.users.blueCo)
      must(await co.muc.join(room, 'blue-co'), 'blue-co joins')
      const seen = record<RoomMessage>((l) => co.muc.onMessage(room, l))
      const observer = await ctx.login(fx.users.blueObs)
      const body = json({ text: uniq('no-join') })
      const sent = await observer.muc.send(room, body)
      expect(errorOf(sent)?.condition).toBe('not-acceptable')
      await sleep(QUIET_MS)
      expect(seen.events.filter((m) => m.body === body)).toEqual([])
    })

    // XEP-0045 §10.2: re-submitting the room config leaves the stored role alone (spike S1b).
    it('the admin re-saving the room config does not restore voice', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.blueHq)
      const admin = ctx.admin()
      const config = must(await admin.muc.getRoomConfig(room), 'read config')
      must(await admin.muc.configureRoom(room, config), 're-save config')
      const observer = await ctx.login(fx.users.blueObs)
      expect(must(await observer.muc.join(room, 'blue-obs'), 'observer joins').role).toBe('visitor')
    })

    // Stored roles apply only in moderated rooms (spike S1, R-C), so every game room must be.
    it('every game room is moderated, members-only and non-anonymous (NFR-3)', async () => {
      const fx = ctx.fx()
      for (const id of Object.values(fx.rooms)) {
        const config = must(await ctx.admin().muc.getRoomConfig(ctx.room(id)), `config ${id}`)
        expect(config).toMatchObject({
          moderated: GAME_ROOM.moderated,
          membersOnly: true,
          whois: 'anyone',
          public: false,
          persistent: true,
          archive: true,
        })
      }
    })

    if (raw === undefined) return

    describe('raw stanza probes', { tags: ['raw'] }, () => {
      /** Sends a probe from the observer; returns what blue-co saw and the observer's error. */
      async function probe(
        build: (room: string, marker: string) => string,
        join = true,
      ): Promise<{ delivered: number; error: string | undefined }> {
        const fx = ctx.fx()
        const room = ctx.room(fx.rooms.blueHq)
        const co = await ctx.login(fx.users.blueCo)
        must(await co.muc.join(room, 'blue-co'), 'blue-co joins')
        const observer: Session = await ctx.login(fx.users.blueObs)
        if (join) must(await observer.muc.join(room, 'blue-obs'), 'observer joins')
        const marker = uniq('probe')
        const coSaw: string[] = []
        const observerSaw: string[] = []
        const stopCo = raw?.onIncoming(co, (xml) => coSaw.push(xml))
        const stopObs = raw?.onIncoming(observer, (xml) => observerSaw.push(xml))
        raw?.send(observer, build(room, marker))
        await sleep(QUIET_MS)
        stopCo?.()
        stopObs?.()
        const errorXml = observerSaw.find((x) => x.includes(marker) && x.includes("type='error'"))
        const condition =
          errorXml === undefined
            ? undefined
            : /<([a-z-]+) xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'\/>/.exec(errorXml)?.[1]
        return { delivered: coSaw.filter((x) => x.includes(marker)).length, error: condition }
      }

      // XEP-0045 §7.5: private messages; ejabberd `allow_private_messages_from_visitors: nobody`.
      it('a private message to an occupant is refused', async () => {
        const r = await probe(
          (room, m) =>
            `<message xmlns="jabber:client" to="${room}/blue-co" type="chat" id="${m}"><body>${m}</body></message>`,
        )
        expect(r.delivered).toBe(0)
        expect(r.error).toBe('forbidden')
      })

      // XEP-0045 §8.1: only those allowed may change the subject; a visitor may not.
      it('a subject change is refused', async () => {
        const r = await probe(
          (room, m) =>
            `<message xmlns="jabber:client" to="${room}" type="groupchat" id="${m}"><subject>${m}</subject></message>`,
        )
        expect(r.delivered).toBe(0)
        expect(r.error).toBe('forbidden')
      })

      // XEP-0308: a correction is a new groupchat message, refused like any other.
      it('a message correction is refused', async () => {
        const r = await probe(
          (room, m) =>
            `<message xmlns="jabber:client" to="${room}" type="groupchat" id="${m}"><body>${m}</body><replace xmlns="urn:xmpp:message-correct:0" id="anything"/></message>`,
        )
        expect(r.delivered).toBe(0)
        expect(r.error).toBe('forbidden')
      })

      // RFC 6121 §5.2.2: type normal to the room JID is not a groupchat; ejabberd drops it.
      it('a type=normal message to the room reaches nobody', async () => {
        const r = await probe(
          (room, m) =>
            `<message xmlns="jabber:client" to="${room}" type="normal" id="${m}"><body>${m}</body></message>`,
        )
        expect(r.delivered).toBe(0)
      })

      // XEP-0045 §7.7: presence updates; ejabberd `allow_visitor_status: false` strips the text.
      it('presence status text is not broadcast', async () => {
        const r = await probe(
          (room, m) =>
            `<presence xmlns="jabber:client" to="${room}/blue-obs"><status>${m}</status></presence>`,
        )
        expect(r.delivered).toBe(0)
      })

      // XEP-0045 §7.6: nick change; ejabberd `allow_visitor_nickchange: false` refuses it.
      it('a nickname change is refused', async () => {
        const r = await probe((room, m) => `<presence xmlns="jabber:client" to="${room}/${m}"/>`)
        expect(r.delivered).toBe(0)
        expect(r.error).toBe('not-allowed')
      })

      // XEP-0045 §7.13: voice requests; ejabberd `allow_voice_requests: false`.
      it('a voice request is refused and the observer stays a visitor', async () => {
        const r = await probe(
          (room, m) =>
            `<message xmlns="jabber:client" to="${room}" id="${m}"><x xmlns="jabber:x:data" type="submit"><field var="FORM_TYPE"><value>http://jabber.org/protocol/muc#request</value></field><field var="muc#role"><value>participant</value></field></x><body>${m}</body></message>`,
        )
        expect(r.delivered).toBe(0)
        expect(r.error).toBe('forbidden')
        const observer = await ctx.login(ctx.fx().users.blueObs)
        const joined = must(
          await observer.muc.join(ctx.room(ctx.fx().rooms.blueHq), 'blue-obs'),
          'join',
        )
        expect(joined.role).toBe('visitor')
      })

      // ejabberd MUC/Sub (urn:xmpp:mucsub:0), off in game rooms (`allow_subscription: false`).
      it('a MUC/Sub subscription is refused, and a post after it is not delivered', async () => {
        const r = await probe(
          (room, m) =>
            `<iq xmlns="jabber:client" type="set" to="${room}" id="${m}"><subscribe xmlns="urn:xmpp:mucsub:0" nick="blue-obs"><event node="urn:xmpp:mucsub:nodes:messages"/></subscribe></iq>`,
          false,
        )
        expect(r.delivered).toBe(0)
        expect(r.error).toBe('not-allowed')
        const after = await probe(
          (room, m) =>
            `<message xmlns="jabber:client" to="${room}" type="groupchat" id="${m}"><body>${m}</body></message>`,
          false,
        )
        expect(after.delivered).toBe(0)
        expect(after.error).toBe('not-acceptable')
      })

      // XEP-0077 §3.3 in-band password change is off (no mod_register, NFR-22): the admin keeps
      // control of observer passwords, the precondition of R-B (spike C01).
      it('the observer cannot change its own password in band', async () => {
        const fx = ctx.fx()
        const r = await probe(
          (_room, m) =>
            `<iq xmlns="jabber:client" type="set" to="${fx.domain}" id="${m}"><query xmlns="jabber:iq:register"><username>${fx.users.blueObs}</username><password>self-chosen</password></query></iq>`,
          false,
        )
        expect(r.error).toBe('service-unavailable')
        await ctx.login(fx.users.blueObs)
      })
    })
  })
}
