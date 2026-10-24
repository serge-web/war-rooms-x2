import { z } from 'zod'
import { hexColourSchema, slugSchema } from './common.ts'

/**
 * Font families bundled with the client (NFR-7). WP 2.8 maps each id to bundled font files;
 * documents store only the id.
 */
export const BUNDLED_FONTS = Object.freeze(['sans', 'serif', 'mono'] as const)

export const themeTokensSchema = z
  .object({
    primary: hexColourSchema.optional(),
    secondary: hexColourSchema.optional(),
    background: hexColourSchema.optional(),
    surface: hexColourSchema.optional(),
    text: hexColourSchema.optional(),
    fontFamily: z.enum(BUNDLED_FONTS).optional().describe('Bundled font id'),
  })
  .describe('Design tokens; an unset token inherits from the game theme, then the default')

/** A theme inside a game, force or room document (SRD §3 rules 10–11). */
export const themeSchema = z
  .object({
    tokens: themeTokensSchema,
    logoAssetId: slugSchema.optional().describe('Id of an `assets:<id>` node'),
    iconAssetId: slugSchema.optional().describe('Id of an `assets:<id>` node'),
  })
  .describe('Theme: tokens plus optional logo and icon assets')

export type ThemeTokens = z.infer<typeof themeTokensSchema>
export type Theme = z.infer<typeof themeSchema>
export type BundledFont = (typeof BUNDLED_FONTS)[number]
