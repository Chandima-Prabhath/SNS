import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from './db'

/**
 * NextAuth config — JWT strategy required for Credentials provider.
 *
 * The JWT stores { id, username, role } which we copy into session.user in the
 * session callback. The realtime mini-service reads the session cookie via
 * GET /api/auth/me to authenticate socket connections.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        identifier: { label: 'Email or Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.password) return null
        const ident = credentials.identifier.trim().toLowerCase()
        const user = await db.user.findFirst({
          where: {
            OR: [{ email: ident }, { username: ident }],
          },
        })
        if (!user) return null
        const valid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!valid) return null
        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          username: user.username,
          role: user.role,
        } as any
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Initial sign-in
        token.id = (user as any).id
        token.username = (user as any).username
        token.role = (user as any).role
      } else if (token.id) {
        // Subsequent token refreshes — fetch the latest role from DB so admin
        // promotions/demotions take effect without forcing a re-login.
        const dbUser = await db.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, username: true, displayName: true },
        })
        if (dbUser) {
          token.role = dbUser.role
          token.username = dbUser.username
          token.name = dbUser.displayName
        }
      }
      return token
    },
    async session({ session, token }) {
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
