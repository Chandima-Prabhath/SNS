import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '@/lib/db'

const RegisterSchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, 'username can only contain letters, numbers, underscores'),
  displayName: z.string().min(1).max(40),
  password: z.string().min(6).max(72),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = RegisterSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message || 'invalid input' },
        { status: 400 }
      )
    }

    const { email, username, displayName, password } = parsed.data
    const lowerEmail = email.toLowerCase()
    const lowerUsername = username.toLowerCase()

    const existing = await db.user.findFirst({
      where: { OR: [{ email: lowerEmail }, { username: lowerUsername }] },
    })
    if (existing) {
      return NextResponse.json({ error: 'email or username already taken' }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await db.user.create({
      data: { email: lowerEmail, username: lowerUsername, displayName, passwordHash },
    })

    // Auto-join the default group + general text channels if they exist
    const defaultGroup = await db.group.findFirst({
      where: { isDm: false },
      include: { channels: true },
    })
    if (defaultGroup) {
      for (const ch of defaultGroup.channels) {
        if (ch.type === 'text') {
          await db.channelMember
            .create({ data: { channelId: ch.id, userId: user.id, role: 'member' } })
            .catch(() => {})
        }
      }
    }

    return NextResponse.json({ ok: true, userId: user.id })
  } catch (e: any) {
    console.error('[register] error', e)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
