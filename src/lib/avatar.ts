/**
 * Avatar generation utility — uses DiceBear to generate SVG avatars locally.
 * No API calls needed. Deterministic from a seed string.
 */
import { createAvatar } from '@dicebear/core'
import { lorelei } from '@dicebear/lorelei'
import { thumbs } from '@dicebear/thumbs'
import { bottts } from '@dicebear/bottts'
import { initials } from '@dicebear/initials'

export type AvatarStyle = 'lorelei' | 'thumbs' | 'bottts' | 'initials'

export const AVATAR_STYLES: { key: AvatarStyle; label: string }[] = [
  { key: 'lorelei', label: 'Character' },
  { key: 'thumbs', label: 'Thumb' },
  { key: 'bottts', label: 'Robot' },
  { key: 'initials', label: 'Initials' },
]

/**
 * Generate an SVG avatar string from a seed and style.
 * Can be used server-side (in API routes) or client-side.
 */
export function generateAvatar(seed: string, style: AvatarStyle = 'lorelei'): string {
  const options = { seed, radius: 50, backgroundColor: ['b6e3f4', 'c0aede', 'd1f4d9', 'ffd5dc', 'ffdfbf'] }
  switch (style) {
    case 'lorelei':
      return createAvatar(lorelei, options).toString()
    case 'thumbs':
      return createAvatar(thumbs, options).toString()
    case 'bottts':
      return createAvatar(bottts, options).toString()
    case 'initials':
      return createAvatar(initials, options).toString()
    default:
      return createAvatar(lorelei, options).toString()
  }
}

/**
 * Generate a data URL from an SVG string (for use in <img src> or <Avatar>).
 */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/**
 * Generate 12 avatar candidates from different seeds for the user to pick from.
 */
export function generateAvatarCandidates(userSeed: string): { style: AvatarStyle; seed: string; svg: string }[] {
  const candidates: { style: AvatarStyle; seed: string; svg: string }[] = []
  // Generate 3 per style = 12 total
  for (const style of AVATAR_STYLES) {
    for (let i = 0; i < 3; i++) {
      const seed = i === 0 ? userSeed : `${userSeed}-${i}`
      candidates.push({
        style: style.key,
        seed,
        svg: generateAvatar(seed, style.key),
      })
    }
  }
  return candidates
}
