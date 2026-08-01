/**
 * Promote a user to owner role.
 *
 * Usage:
 *   bunx tsx scripts/promote-owner.ts <username>
 *
 * This replaces the old /api/seed endpoint which allowed any authenticated
 * user to become owner by calling the endpoint first (privilege escalation).
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const username = process.argv[2]
  if (!username) {
    console.error('Usage: bunx tsx scripts/promote-owner.ts <username>')
    process.exit(1)
  }

  const user = await db.user.findUnique({ where: { username } })
  if (!user) {
    console.error(`User "${username}" not found`)
    process.exit(1)
  }

  await db.user.update({
    where: { id: user.id },
    data: { role: 'owner' },
  })

  console.log(`✓ Promoted @${username} (${user.displayName}) to owner`)
}

main()
  .catch((e) => {
    console.error('Failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
