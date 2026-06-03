const db = require('./db');
const { allowsType } = require('./notificationPrefs');

// Records a durable in-app activity-feed entry for a recipient. Written next to
// every `sendPush` so users have a persistent "what happened while I was away"
// inbox in addition to ephemeral push notifications.
//
// Unlike push (network, fire-and-forget), this is a fast local DB write — call
// sites `await` it so the entry exists before the response is returned, which
// also keeps it deterministic under test.
async function recordActivity(userId, { type, title, body, data } = {}) {
  if (!userId) return null;
  try {
    // Respect the recipient's per-type notification preference.
    if (!(await allowsType(userId, type))) return null;
    return await db.activity.create({
      data: { userId, type, title, body, data: data ?? undefined },
    });
  } catch (err) {
    // Never let feed bookkeeping break the request that triggered it.
    console.error('[activity] failed to record:', err);
    return null;
  }
}

module.exports = { recordActivity };
