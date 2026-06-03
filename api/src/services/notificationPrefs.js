const db = require('./db');

// Maps a notification/activity type to the User column that gates it. Both the
// push delivery (services/push.js) and the in-app activity feed
// (services/activity.js) consult this so a single toggle silences a category
// across both channels.
const PREF_COLUMN = {
  LEAD: 'notifyLeads',
  MESSAGE: 'notifyMessages',
  APPOINTMENT: 'notifyAppointments',
  REVIEW: 'notifyReviews',
};

// Whether a user wants notifications of a given type. Defaults to true for
// unknown types or a missing user, so a misconfiguration never silently drops
// everything.
async function allowsType(userId, type) {
  const column = PREF_COLUMN[type];
  if (!userId || !column) return true;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { [column]: true },
  });
  if (!user) return true;
  return user[column] !== false;
}

module.exports = { allowsType, PREF_COLUMN };
