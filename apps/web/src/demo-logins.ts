// The demo logins listed on the mock's login form, from the demo seed, each with its known demo
// password (NFR-6). A mock database imported later may have other roles; these are the seed's.
// The admin login is listed last, as the umpire in the White Force: the admin plays as the
// umpire in the game view (glossary, SC-5).
import { UMPIRE_NAME, whiteForceOf } from '@wrx/domain'
import { demoPassword, demoSeed } from '@wrx/mock-server'
import type { DemoLogin } from '@wrx/player-ui'
import { designFileSchema } from '@wrx/schemas'

export function demoLogins(): readonly DemoLogin[] {
  const parsed = designFileSchema.safeParse(demoSeed().design)
  if (!parsed.success) return Object.freeze([])
  const { forces, roles } = parsed.data
  const forceOrder = (id: string) => forces.findIndex((f) => f.id === id)
  const forceName = (id: string) => forces.find((f) => f.id === id)?.name ?? id
  const white = whiteForceOf(forces)
  return Object.freeze([
    ...[...roles]
      .sort((a, b) => forceOrder(a.forceId) - forceOrder(b.forceId) || a.order - b.order)
      .map((role) => ({
        roleId: role.id,
        label: `${role.name} (${forceName(role.forceId)})`,
        password: demoPassword(role.id),
      })),
    {
      roleId: 'admin',
      label: `${UMPIRE_NAME} (${white === undefined ? 'admin' : `${white.name}, admin`})`,
      password: demoPassword('admin'),
    },
  ])
}
