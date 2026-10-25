// Generated ids (SRD §3 rule 1): stable, URL-safe slugs made from the display name at creation.
import { LIMITS, slugSchema } from '@wrx/schemas'

/**
 * The slug form of a display name: lowercase ASCII letters and digits, single hyphens, at most
 * `LIMITS.slugChars` long. Accents are dropped ("Café" → "cafe"); a name with no letters or
 * digits gives `fallback`.
 */
export function slugify(name: string, fallback: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return trimTo(slug, LIMITS.slugChars) || fallback
}

/**
 * The first of `base`, `base-2`, `base-3`… that `taken` does not hold. The base is shortened
 * when needed so the suffixed id still fits `LIMITS.slugChars`.
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = `${trimTo(base, LIMITS.slugChars - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

export function isSlug(value: string): boolean {
  return slugSchema.safeParse(value).success
}

function trimTo(slug: string, max: number): string {
  return slug.length <= max ? slug : slug.slice(0, max).replace(/-+$/, '')
}
