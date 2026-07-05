// Listing eligibility — the one place that answers "is this business publicly
// visible?". A business is listed while its free first month is running
// (freeListingEndsAt, stamped at first admin approval) OR while its $10/mo
// listing subscription is trialing/active. Every public surface — search,
// profiles, the Inspiration feed, AI-chat recommendations — filters through
// these helpers so delisting behaves consistently everywhere.

const PRO_ACTIVE_STATUSES = ['trialing', 'active'];

const FREE_LISTING_DAYS = () => parseInt(process.env.FREE_LISTING_DAYS || '30', 10);

function isProActive(business) {
  return PRO_ACTIVE_STATUSES.includes(business?.proStatus);
}

// Full eligibility check for a loaded business row (needs approvalStatus,
// proStatus, and freeListingEndsAt selected).
function isListed(business, now = new Date()) {
  if (!business || business.approvalStatus !== 'APPROVED') return false;
  if (isProActive(business)) return true;
  return Boolean(business.freeListingEndsAt && business.freeListingEndsAt > now);
}

// Prisma `where` fragment for "currently listed". Spread it into a where that
// already scopes approvalStatus: 'APPROVED' (it only covers the payment leg).
function listedWhere(now = new Date()) {
  return {
    OR: [
      { proStatus: { in: PRO_ACTIVE_STATUSES } },
      { freeListingEndsAt: { gt: now } },
    ],
  };
}

// The free month a business gets before the subscription is required,
// anchored at first admin approval.
function freeListingEnd(from = new Date()) {
  return new Date(from.getTime() + FREE_LISTING_DAYS() * 24 * 60 * 60 * 1000);
}

module.exports = { PRO_ACTIVE_STATUSES, FREE_LISTING_DAYS, isProActive, isListed, listedWhere, freeListingEnd };
