/**
 * DM Deduplication Cleanup Script
 * ===============================
 *
 * Removes duplicate DM channels between the same pair of users and backfills
 * DmLink rows for the surviving DMs. Run once after deploying the DmLink
 * schema change.
 *
 * Usage:
 *   bunx tsx scripts/dedupe-dms.ts
 *
 * What it does:
 *   1. Fetches all DM groups (isDm=true) with their channel members
 *   2. Groups them by the canonical (userAId, userBId) pair
 *   3. For pairs with multiple DMs: keeps the OLDEST, deletes the rest
 *      (cascade deletes channels + members + messages)
 *   4. Creates a DmLink row for the surviving DM if one doesn't exist
 *
 * Safe to run multiple times — idempotent.
 */

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('─'.repeat(60))
  console.log('DM Deduplication Cleanup')
  console.log('─'.repeat(60))

  // Fetch all DM groups with their channels and members
  const dmGroups = await db.group.findMany({
    where: { isDm: true },
    include: {
      channels: {
        include: {
          members: { select: { userId: true } },
        },
      },
      dmLink: true,
    },
    orderBy: { createdAt: 'asc' }, // oldest first — we keep the oldest
  })

  console.log(`Found ${dmGroups.length} DM groups total`)

  // Group by canonical (userAId, userBId) pair
  const pairs = new Map<string, typeof dmGroups>()
  for (const g of dmGroups) {
    // Collect all unique member userIds across all channels in this group
    const memberIds = new Set<string>()
    for (const ch of g.channels) {
      for (const m of ch.members) {
        memberIds.add(m.userId)
      }
    }
    if (memberIds.size < 2) {
      console.log(`  ⚠️  DM group ${g.id} ("${g.name}") has < 2 members — skipping`)
      continue
    }
    // For a true 1:1 DM, there should be exactly 2 members. If there are more,
    // this isn't a standard DM — skip it (leave it alone).
    if (memberIds.size > 2) {
      console.log(`  ⚠️  DM group ${g.id} ("${g.name}") has ${memberIds.size} members — not a 1:1 DM, skipping`)
      continue
    }
    const [a, b] = [...memberIds].sort()
    const key = `${a}|${b}`
    if (!pairs.has(key)) pairs.set(key, [])
    pairs.get(key)!.push(g)
  }

  let duplicatesDeleted = 0
  let linksCreated = 0
  let linksExisting = 0

  for (const [key, groups] of pairs) {
    const [userAId, userBId] = key.split('|')

    if (groups.length > 1) {
      console.log(`  🔁 Pair ${userAId.slice(0, 8)}..|${userBId.slice(0, 8)}.. has ${groups.length} DMs — keeping oldest, deleting rest`)
      const [keep, ...dups] = groups
      for (const dup of dups) {
        await db.group.delete({ where: { id: dup.id } })
        console.log(`     deleted duplicate group ${dup.id} ("${dup.name}")`)
        duplicatesDeleted++
      }

      // Backfill DmLink for the surviving group
      if (!keep.dmLink) {
        await db.dmLink.create({
          data: { userAId, userBId, groupId: keep.id },
        })
        console.log(`     created DmLink for surviving group ${keep.id}`)
        linksCreated++
      } else {
        linksExisting++
      }
    } else {
      // Single DM — just backfill the DmLink if missing
      const group = groups[0]
      if (!group.dmLink) {
        try {
          await db.dmLink.create({
            data: { userAId, userBId, groupId: group.id },
          })
          linksCreated++
        } catch (e: any) {
          if (e?.code === 'P2002') {
            // A DmLink already exists for this pair pointing to a different group
            // — this means we have a duplicate we missed. Delete this group.
            console.log(`  ⚠️  Pair ${userAId.slice(0, 8)}..|${userBId.slice(0, 8)}.. already has a DmLink — deleting orphan group ${group.id}`)
            await db.group.delete({ where: { id: group.id } })
            duplicatesDeleted++
          } else {
            throw e
          }
        }
      } else {
        linksExisting++
      }
    }
  }

  console.log('─'.repeat(60))
  console.log(`Done!`)
  console.log(`  Duplicate DMs deleted: ${duplicatesDeleted}`)
  console.log(`  DmLink rows created:   ${linksCreated}`)
  console.log(`  DmLink rows existing:   ${linksExisting}`)
  console.log('─'.repeat(60))
}

main()
  .catch((e) => {
    console.error('Cleanup failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
