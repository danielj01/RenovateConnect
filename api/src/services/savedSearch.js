const db = require('./db');
const { recordActivity } = require('./activity');
const { sendPush } = require('./push');

// Does a business satisfy a saved search? Each non-null criterion must match;
// semantics mirror the public GET /businesses search (city/q are case-insensitive
// substring, state is exact, specialty is array membership).
function matches(search, business) {
  if (search.specialty && !business.specialties.includes(search.specialty)) return false;
  if (search.city && !business.city.toLowerCase().includes(search.city.toLowerCase())) return false;
  if (search.state && business.state.toUpperCase() !== search.state.toUpperCase()) return false;
  if (search.q && !business.companyName.toLowerCase().includes(search.q.toLowerCase())) return false;
  return true;
}

// A human-readable label for a search, used when the owner didn't name it.
function describeSearch(search) {
  const parts = [];
  if (search.specialty) parts.push(search.specialty);
  if (search.q) parts.push(`"${search.q}"`);
  const loc = [search.city, search.state].filter(Boolean).join(', ');
  if (loc) parts.push(`in ${loc}`);
  return parts.join(' ') || 'your saved search';
}

// Alert the owners of every saved search a newly available business matches.
// Fires both an activity-feed entry (awaited, deterministic) and a push (fire-
// and-forget). Returns the number of owners notified. Never throws — alerting
// must not break the request that created the business.
async function notifyMatchingSearches(business) {
  try {
    const searches = await db.savedSearch.findMany();
    let notified = 0;
    for (const search of searches) {
      // Don't alert a business owner about their own newly created profile.
      if (search.userId === business.userId) continue;
      if (!matches(search, business)) continue;

      const label = search.name || describeSearch(search);
      await recordActivity(search.userId, {
        type: 'SAVED_SEARCH',
        title: 'New match for your saved search',
        body: `${business.companyName} matches ${label}.`,
        data: { businessId: business.id, savedSearchId: search.id },
      });
      sendPush(search.userId, {
        type: 'SAVED_SEARCH',
        title: 'New contractor match',
        body: `${business.companyName} matches your saved search.`,
        data: { businessId: business.id },
      }).catch(console.error);
      await db.savedSearch.update({
        where: { id: search.id },
        data: { lastNotifiedAt: new Date() },
      });
      notified += 1;
    }
    return notified;
  } catch (err) {
    console.error('[savedSearch] alerting failed:', err);
    return 0;
  }
}

module.exports = { matches, describeSearch, notifyMatchingSearches };
