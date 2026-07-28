/**
 * Backfill GroupMember rows for existing groups.
 * For each group, ensure the owner has a GroupMember entry with role='owner',
 * and any user who is a ChannelMember of a channel in that group but has no
 * GroupMember entry gets one with role='member'.
 */
import { db } from '../src/lib/db'

async function main() {
  const groups = await db.group.findMany({ include: { channels: { include: { members: true } } } })
  let created = 0
  for (const g of groups) {
    // Ensure owner has a GroupMember entry
    const existingOwner = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: g.id, userId: g.ownerId } },
    })
    if (!existingOwner) {
      await db.groupMember.create({ data: { groupId: g.id, userId: g.ownerId, role: 'owner' } })
      created++
    }
    // For each channel member, ensure they have a GroupMember entry
    const seen = new Set<string>([g.ownerId])
    for (const ch of g.channels) {
      for (const m of ch.members) {
        if (seen.has(m.userId)) continue
        seen.add(m.userId)
        const existing = await db.groupMember.findUnique({
          where: { groupId_userId: { groupId: g.id, userId: m.userId } },
        })
        if (!existing) {
          await db.groupMember.create({ data: { groupId: g.id, userId: m.userId, role: 'member' } })
          created++
        }
      }
    }
  }
  console.log(`Backfilled ${created} GroupMember rows across ${groups.length} groups.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
