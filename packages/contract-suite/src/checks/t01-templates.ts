// T01 message templates (Annex A, WP 4.1): the `templates` node as the admin tooling provisions
// it (whitelist, every role a member, the admin owner and only publisher, one item per template,
// item id its GUID). Every role reads the templates; nobody but the admin publishes or retracts
// one; anonymous sessions read nothing; a template over the item limit is refused before it is
// sent, and the largest that fits is accepted.
import { LIMITS, newEntityId, parseDocument, templateSchema } from '@wrx/schemas'
import type { Template } from '@wrx/schemas'
import type { ItemsEvent } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { errorOf, must, record } from '../harness.ts'

function template(name: string, extra: Partial<Template> = {}): Template {
  return {
    schemaVersion: 1,
    id: newEntityId(),
    name,
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', title: 'Summary', maxLength: 500 },
        force: { type: 'string', title: 'Force', 'x-wrx-picker': 'force' },
      },
      required: ['summary'],
    },
    createdAt: '2026-10-24T09:00:00.000Z',
    ...extra,
  }
}

/** The largest template the item limit takes: a long description of options. */
function largest(): Template {
  const base = template('Largest')
  const room = LIMITS.pubsubItemBytes - LIMITS.pubsubItemOverheadBytes
  const options = (n: number) =>
    Array.from({ length: n }, (_, i) => `${'o'.repeat(190)}${String(i).padStart(4, '0')}`)
  // Fill fields of 500 options each until one more would not fit.
  const properties: Record<string, unknown> = {}
  let i = 0
  for (;;) {
    const next = { ...properties, [`f${i}`]: { type: 'string', enum: options(500) } }
    const candidate = { ...base, schema: { type: 'object', properties: next } }
    if (JSON.stringify(candidate).length > room) break
    properties[`f${i}`] = next[`f${i}`]
    i++
  }
  // Then one field with as many options as still fit.
  let n = 1
  while (
    JSON.stringify({
      ...base,
      schema: {
        type: 'object',
        properties: { ...properties, last: { type: 'string', enum: options(n + 1) } },
      },
    }).length <= room
  ) {
    n++
  }
  return {
    ...base,
    schema: {
      type: 'object',
      properties: { ...properties, last: { type: 'string', enum: options(n) } },
    },
  }
}

export function t01(ctx: Ctx): void {
  describe('T01 message templates', () => {
    // XEP-0060 §6.5 retrieve on a whitelist node: every member reads; §7.1.3.1 publish without
    // publish rights is <forbidden/>.
    it('every role reads the templates; no role publishes one, not even the White Force writer', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const sitrep = template('Situation report')
      must(
        await admin.pubsub.publish(fx.nodes.templates, sitrep.id, JSON.stringify(sitrep)),
        'publish',
      )
      for (const user of Object.values(fx.users)) {
        const session = await ctx.login(user)
        const items = must(await session.pubsub.getItems(fx.nodes.templates), `${user} reads`)
        const item = items.find((i) => i.id === sitrep.id)
        expect(item, user).toBeDefined()
        const parsed = parseDocument('template', item?.payload ?? '')
        expect(parsed.ok && parsed.value.id, user).toBe(sitrep.id)
        const forged = template('Forged', { id: sitrep.id })
        expect(
          errorOf(
            await session.pubsub.publish(fx.nodes.templates, sitrep.id, JSON.stringify(forged)),
          ),
          user,
        ).toMatchObject({ condition: 'forbidden', type: 'auth' })
        const own = template('Own')
        expect(
          errorOf(await session.pubsub.publish(fx.nodes.templates, own.id, JSON.stringify(own)))
            ?.condition,
          user,
        ).toBe('forbidden')
      }
      const after = must(await admin.pubsub.getItems(fx.nodes.templates), 'read back')
      const kept = after.find((i) => i.id === sitrep.id)
      expect(
        parseDocument('template', kept?.payload ?? '').ok && JSON.parse(kept?.payload ?? '{}'),
      ).toMatchObject({
        name: 'Situation report',
      })
    })

    // §7.2: only the owner retracts here (every item is the admin's); subscribers hear it, which
    // is how publish removes a template the design no longer has.
    it('only the admin retracts a template, and readers are told', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const old = template('Old')
      must(await admin.pubsub.publish(fx.nodes.templates, old.id, JSON.stringify(old)), 'publish')
      const red = await ctx.login(fx.users.redCo)
      expect(errorOf(await red.pubsub.retract(fx.nodes.templates, old.id))?.condition).toBe(
        'forbidden',
      )
      must(await red.pubsub.subscribe(fx.nodes.templates), 'red subscribes')
      const heard = record<ItemsEvent>((l) => red.pubsub.onItems(fx.nodes.templates, l))
      must(await admin.pubsub.retract(fx.nodes.templates, old.id), 'admin retracts')
      await heard.next((e) => e.retracted.includes(old.id))
      const ids = must(await admin.pubsub.getItems(fx.nodes.templates), 'read').map((i) => i.id)
      expect(ids).not.toContain(old.id)
    })

    // §4.5 whitelist: <not-allowed/> for anyone not on it, anonymous sessions included (NFR-21).
    it('an anonymous session can neither read nor subscribe to the templates', async () => {
      const fx = ctx.fx()
      const anon = await ctx.anonymous()
      expect(errorOf(await anon.pubsub.getItems(fx.nodes.templates))?.condition).toBe('not-allowed')
      expect(errorOf(await anon.pubsub.subscribe(fx.nodes.templates))?.condition).toBe(
        'not-allowed',
      )
    })

    // PLY-53, R15: the template document's schema refuses what the item limit would; the largest
    // template that fits publishes and reads back intact, and one byte more is `too-large` at the
    // transport, before anything is sent.
    it('the largest template that fits is accepted; one over the item limit is refused', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const big = largest()
      expect(templateSchema.safeParse(big).success).toBe(true)
      must(await admin.pubsub.publish(fx.nodes.templates, big.id, JSON.stringify(big)), 'largest')
      const read = must(await admin.pubsub.getItems(fx.nodes.templates), 'read')
      expect(JSON.parse(read.find((i) => i.id === big.id)?.payload ?? '{}')).toEqual(big)
      const over = {
        ...big,
        id: newEntityId(),
        name: `${big.name}x`,
        description: 'x'.repeat(1_000),
      }
      expect(templateSchema.safeParse(over).success).toBe(false)
      expect(
        errorOf(await admin.pubsub.publish(fx.nodes.templates, over.id, JSON.stringify(over)))
          ?.condition,
      ).toBe('too-large')
    })
  })
}
