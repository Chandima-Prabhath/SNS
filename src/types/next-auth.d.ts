/**
 * NextAuth type augmentation — adds custom fields to the Session user.
 *
 * Without this, TypeScript doesn't know about `id`, `username`, `role`
 * on `session.user` — every access requires `session.user.id`.
 *
 * With this file, `session.user.id` is properly typed as `string`.
 * The 80+ `as any` casts across the codebase can be gradually removed.
 */
import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name: string | null
      username: string
      role: string
      displayName?: string
      avatarUrl?: string | null
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    username?: string
    role?: string
    tokenVersion?: number
  }
}
