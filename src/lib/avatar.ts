/**
 * Avatar generation utility — uses DiceBear HTTP API.
 *
 * We can't use the DiceBear npm packages directly because they're ESM-only
 * and don't work with Next.js SSR (the 'escape' export from @dicebear/core
 * is missing during SSR compilation).
 *
 * Instead, we generate avatar URLs using the DiceBear HTTP API:
 *   https://api.dicebear.com/9.x/<style>/svg?seed=<seed>
 *
 * These URLs can be used directly in <img src> or <Avatar> components.
 * No npm packages needed, no SSR issues.
 */

export type AvatarStyle = 'lorelei' | 'bottts' | 'initials'

export const AVATAR_STYLES: { key: AvatarStyle; label: string }[] = [
  { key: 'lorelei', label: 'Character' },
  { key: 'bottts', label: 'Robot' },
  { key: 'initials', label: 'Initials' },
]

const DICEBEAR_API = 'https://api.dicebear.com/9.x'

/**
 * Generate an avatar URL from a seed and style.
 * Returns a URL string that can be used directly in <img src>.
 */
export function generateAvatarUrl(seed: string, style: AvatarStyle = 'lorelei'): string {
  const params = new URLSearchParams({
    seed,
    radius: '50',
    backgroundColor: 'b6e3f4,c0aede,d1f4d9,ffd5dc,ffdfbf',
  })
  return `${DICEBEAR_API}/${style}/svg?${params.toString()}`
}

/**
 * Generate 9 avatar candidate URLs (3 styles × 3 seeds) for the user to pick from.
 */
export function generateAvatarCandidates(userSeed: string): { style: AvatarStyle; seed: string; url: string }[] {
  const candidates: { style: AvatarStyle; seed: string; url: string }[] = []
  for (const style of AVATAR_STYLES) {
    for (let i = 0; i < 3; i++) {
      const seed = i === 0 ? userSeed : `${userSeed}-${i}`
      candidates.push({
        style: style.key,
        seed,
        url: generateAvatarUrl(seed, style.key),
      })
    }
  }
  return candidates
}
