// Block lookup helpers — used by messaging and conversation listing to refuse
// contact between users who've blocked each other (in either direction).

const db = require('./db');

// Returns true if either user has blocked the other. Symmetric — blocking is
// a one-way action but enforcement is mutual: once A blocks B, neither side
// can reach the other.
async function areBlocked(userIdA, userIdB) {
  if (!userIdA || !userIdB || userIdA === userIdB) return false;
  const hit = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: userIdA, blockedId: userIdB },
        { blockerId: userIdB, blockedId: userIdA },
      ],
    },
    select: { id: true },
  });
  return Boolean(hit);
}

// Returns the set of user ids the given user has either blocked or been
// blocked by. Used to filter conversation lists.
async function blockedUserIds(userId) {
  if (!userId) return new Set();
  const rows = await db.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  const out = new Set();
  for (const r of rows) {
    if (r.blockerId !== userId) out.add(r.blockerId);
    if (r.blockedId !== userId) out.add(r.blockedId);
  }
  return out;
}

module.exports = { areBlocked, blockedUserIds };
