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

/**
 * DiceBear 9.x avatar styles. We expose a wide variety so users have plenty
 * of choices — illustrated characters, robots, pixel art, geometric shapes,
 * etc. Each style generates deterministic output from a seed.
 *
 * See https://dicebear.com/how-to-use/http-api/ for the full style list.
 */
export type AvatarStyle =
  | 'adventurer'
  | 'avataaars'
  | 'big-ears'
  | 'big-smile'
  | 'bottts'
  | 'fun-emoji'
  | 'lorelei'
  | 'micah'
  | 'miniavs'
  | 'notionists'
  | 'open-peeps'
  | 'personas'
  | 'pixel-art'
  | 'shapes'

export const AVATAR_STYLES: { key: AvatarStyle; label: string }[] = [
  { key: 'adventurer', label: 'Adventurer' },
  { key: 'avataaars', label: 'Cartoon' },
  { key: 'big-ears', label: 'Big Ears' },
  { key: 'big-smile', label: 'Big Smile' },
  { key: 'bottts', label: 'Robot' },
  { key: 'fun-emoji', label: 'Emoji' },
  { key: 'lorelei', label: 'Lorelei' },
  { key: 'micah', label: 'Micah' },
  { key: 'miniavs', label: 'Minimal' },
  { key: 'notionists', label: 'Notionists' },
  { key: 'open-peeps', label: 'Open Peeps' },
  { key: 'personas', label: 'Personas' },
  { key: 'pixel-art', label: 'Pixel Art' },
  { key: 'shapes', label: 'Shapes' },
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
 * Generate avatar candidate URLs for the user to pick from.
 *
 * We use every available DiceBear style (14 styles) and generate 4 seed
 * variations per style, yielding 56 candidates total. This gives users a
 * broad range of looks — from illustrated characters and robots to pixel
 * art and geometric shapes — without any two avatars looking alike.
 */
export function generateAvatarCandidates(
  userSeed: string
): { style: AvatarStyle; seed: string; url: string; label: string }[] {
  const candidates: { style: AvatarStyle; seed: string; url: string; label: string }[] = []
  for (const style of AVATAR_STYLES) {
    for (let i = 0; i < 4; i++) {
      // Variation 0 uses the raw user seed so the "first" avatar of each
      // style is consistent with the user's identity; variations 1-3 derive
      // new seeds so the user gets genuine variety within each style.
      const seed = i === 0 ? userSeed : `${userSeed}-${style.key}-${i}`
      candidates.push({
        style: style.key,
        seed,
        url: generateAvatarUrl(seed, style.key),
        label: style.label,
      })
    }
  }
  return candidates
}
