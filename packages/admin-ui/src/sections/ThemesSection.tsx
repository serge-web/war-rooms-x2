// Themes (ADM-18–22): an empty slot until WP 2.8 fills it through `AdminApp`'s `themes` prop.
import type { ComponentType } from 'react'
import { SectionFrame } from '../components/index.ts'
import type { SectionProps } from './common.tsx'

/** What WP 2.8's themes editor receives: the draft, its checks, and the commit callback. */
export type ThemesSlotProps = SectionProps
export type ThemesSlot = ComponentType<ThemesSlotProps>

export function ThemesSectionCore({
  slot: Slot,
  ...props
}: SectionProps & { readonly slot?: ThemesSlot | undefined }) {
  return (
    <SectionFrame title="Themes">
      {Slot === undefined ? (
        <p className="wrx-admin-muted">
          Theme editing (game, force and room themes, logos and icons) is not available yet.
        </p>
      ) : (
        <Slot {...props} />
      )}
    </SectionFrame>
  )
}
