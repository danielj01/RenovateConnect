// Listing-lifecycle notices — the warning layer in front of the delisting rule
// in services/listing.js.
//
// A business is publicly visible while its free first month runs OR its
// subscription is trialing/active. Without this sweep, the transition out of
// that state is completely silent: at day 30 the profile just stops appearing
// in search and the contractor never learns why they stopped getting leads.
//
// Two notices, each sent at most once per lapse cycle:
//   1. EXPIRING — free month ends within LISTING_WARN_DAYS (default 5) and
//      there's no live subscription to carry them past it.
//   2. LAPSED   — the business is approved but no longer listed at all.
//
// Idempotency is a stamp per notice on the Business row
// (listingExpiryWarnedAt / listingLapsedNoticeAt). Both are cleared when a
// subscription goes live (routes/webhooks.js), so a later lapse warns again.
//
// Driven by POST /internal/listing-sweep (routes/internal.js) on a daily cron.

const db = require('./db');
const emailService = require('./email');
const { sendPush } = require('./push');
const { recordActivity } = require('./activity');
const { PRO_ACTIVE_STATUSES } = require('./listing');

const LISTING_WARN_DAYS = () => parseInt(process.env.LISTING_WARN_DAYS || '5', 10);

const DAY_MS = 24 * 60 * 60 * 1000;

// "Has no live subscription", written to also match a NULL proStatus.
// A bare `NOT: { proStatus: { in: [...] } }` would silently drop every row
// where proStatus IS NULL — SQL's `NULL IN (…)` is NULL, not TRUE, so the
// negation isn't TRUE either — which is precisely the never-subscribed
// business this sweep exists to notify.
const NOT_SUBSCRIBED = {
  OR: [
    { proStatus: null },
    { proStatus: { notIn: PRO_ACTIVE_STATUSES } },
  ],
};

function daysUntil(date, now) {
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / DAY_MS));
}

// Deliver one notice across all three channels. Push and email are
// best-effort — neither may block the sweep or prevent the stamp being
// written, or a transient provider outage would re-notify on every run.
async function deliver(business, { type, title, body, subject }) {
  const userId = business.userId;
  const email = business.user?.email;

  await recordActivity(userId, {
    type: 'LISTING',
    title,
    body,
    data: { businessId: business.id },
  }).catch((e) => console.error('[listingLifecycle] activity failed', e.message));

  await sendPush(userId, {
    type: 'LISTING',
    title,
    body,
    data: { type: 'listing', businessId: business.id },
  }).catch((e) => console.error('[listingLifecycle] push failed', e.message));

  if (email) {
    try {
      await subject(email);
    } catch (e) {
      console.error(`[listingLifecycle] ${type} email failed for ${business.id}:`, e.message);
    }
  }
}

// Businesses whose free month ends soon and who have no live subscription to
// carry them past it. Already-warned rows are excluded by the stamp.
async function warnExpiring(now = new Date()) {
  const cutoff = new Date(now.getTime() + LISTING_WARN_DAYS() * DAY_MS);
  const due = await db.business.findMany({
    where: {
      approvalStatus: 'APPROVED',
      listingExpiryWarnedAt: null,
      freeListingEndsAt: { gt: now, lte: cutoff },
      ...NOT_SUBSCRIBED,
    },
    include: { user: { select: { email: true } } },
  });

  for (const business of due) {
    const daysLeft = daysUntil(business.freeListingEndsAt, now);
    const when = daysLeft <= 1 ? 'tomorrow' : `in ${daysLeft} days`;
    await deliver(business, {
      type: 'expiring',
      title: `Your free listing month ends ${when}`,
      body: `Subscribe for $10/month to keep ${business.companyName} visible to homeowners.`,
      subject: (email) => emailService.sendListingExpiringNotice(email, {
        companyName: business.companyName,
        daysLeft,
      }),
    });
    await db.business.update({
      where: { id: business.id },
      data: { listingExpiryWarnedAt: new Date() },
    });
  }
  return due.length;
}

// Businesses that are approved but no longer publicly listed — the free month
// is gone (or was never granted) and there's no live subscription.
async function noticeLapsed(now = new Date()) {
  const due = await db.business.findMany({
    where: {
      approvalStatus: 'APPROVED',
      listingLapsedNoticeAt: null,
      // Two independent OR groups, so they're AND-ed explicitly rather than
      // one clobbering the other at the same key.
      AND: [
        NOT_SUBSCRIBED,
        { OR: [{ freeListingEndsAt: null }, { freeListingEndsAt: { lte: now } }] },
      ],
    },
    include: { user: { select: { email: true } } },
  });

  for (const business of due) {
    await deliver(business, {
      type: 'lapsed',
      title: 'Your listing is now hidden',
      body: `${business.companyName} no longer appears in search. Subscribe to go live again.`,
      subject: (email) => emailService.sendListingLapsedNotice(email, {
        companyName: business.companyName,
      }),
    });
    await db.business.update({
      where: { id: business.id },
      data: { listingLapsedNoticeAt: new Date() },
    });
  }
  return due.length;
}

// One full pass. Warn first, then notice lapses, so a business that crosses
// both thresholds between runs still gets the heads-up before the bad news.
async function runListingSweep(now = new Date()) {
  const warned = await warnExpiring(now);
  const lapsed = await noticeLapsed(now);
  return { warned, lapsed };
}

// Clear both stamps so a future lapse notifies again. Called when a
// subscription goes live.
async function resetListingNotices(businessId) {
  if (!businessId) return;
  await db.business.updateMany({
    where: { id: businessId },
    data: { listingExpiryWarnedAt: null, listingLapsedNoticeAt: null },
  });
}

module.exports = {
  runListingSweep,
  warnExpiring,
  noticeLapsed,
  resetListingNotices,
  LISTING_WARN_DAYS,
};
