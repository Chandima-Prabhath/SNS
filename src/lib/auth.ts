import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from './db'

/**
 * NextAuth config — JWT strategy with tokenVersion-based session invalidation.
 *
 * Security features:
 *   - tokenVersion: incrementing this on the User invalidates ALL existing
 *     JWTs (force logout everywhere). The jwt callback checks this on every
 *     token refresh — if the DB tokenVersion doesn't match the JWT's, the
 *     token is invalidated (returns {} which forces re-auth).
 *   - UserSession table: tracks each active session per device (userAgent,
 *     IP, lastActiveAt). Users can view and revoke individual sessions.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        identifier: { label: 'Email or Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.identifier || !credentials?.password) return null
        const ident = credentials.identifier.trim().toLowerCase()
        const user = await db.user.findFirst({
          where: { OR: [{ email: ident }, { username: ident }] },
        })
        if (!user) return null
        const valid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!valid) return null

        // Create a UserSession record for device tracking
        const userAgent = req?.headers?.['user-agent'] || 'unknown'
        const forwarded = req?.headers?.['x-forwarded-for'] as string | undefined
        const ip = forwarded?.split(',')[0]?.trim() || req?.headers?.['x-real-ip'] as string | undefined || 'unknown'

        await db.userSession.create({
          data: { userId: user.id, userAgent, ip },
        }).catch(() => {}) // best-effort — don't block login

        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          username: user.username,
          role: user.role,
          tokenVersion: user.tokenVersion,
        } as any
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Initial sign-in — store tokenVersion from DB
        token.id = (user as any).id
        token.username = (user as any).username
        token.role = (user as any).role
        token.tokenVersion = (user as any).tokenVersion ?? 0
      } else if (token.id) {
        // Subsequent token refreshes — check tokenVersion for invalidation,
        // and fetch the latest role from DB so admin promotions/demotions
        // take effect without forcing a re-login.
        const dbUser = await db.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, username: true, displayName: true, tokenVersion: true },
        })

        // If user was deleted or tokenVersion was bumped (force logout),
        // invalidate the token by returning an empty object.
        if (!dbUser || dbUser.tokenVersion !== token.tokenVersion) {
          return {} as any // forces re-auth
        }

        token.role = dbUser.role
        token.username = dbUser.username
        token.name = dbUser.displayName
        token.tokenVersion = dbUser.tokenVersion

        // Update lastActiveAt on UserSession records (best-effort, don't block)
        db.userSession.updateMany({
          where: { userId: token.id as string, lastActiveAt: { lt: new Date(Date.now() - 60000) } },
          data: { lastActiveAt: new Date() },
        }).catch(() => {})
      }
      return token
    },
    async session({ session, token }) {
      // If token was invalidated (empty object from jwt callback), return
      // a session without user data — the client will redirect to login.
      if (!token.id) {
        return { ...session, user: undefined } as any
      }
      if (token && session.user) {
        ;(session.user as any).id = token.id
        ;(session.user as any).username = token.username
        ;(session.user as any).role = token.role
      }
      return session
    },
  },
  pages: {
    signIn: '/',
  },
}
