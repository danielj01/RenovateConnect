const router = require('express').Router();
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const {
  createProCheckoutSession,
  cancelProSubscription,
  createBoostCheckoutSession,
} = require('../services/stripe');
const { isProActive, isListed } = require('../services/listing');

// How many businesses in one city can hold an active boost at the same time —
// first-come, first-served scarcity is what makes the boost worth $5. A
// business extending its own running boost never counts against the cap.
const BOOST_CITY_CAP = () => parseInt(process.env.BOOST_CITY_CAP || '3', 10);

// Aggregated demand is only shared in buckets of at least this many — small
// buckets are suppressed so nothing can be tied back to an individual/small
// group (CCPA de-identification / GDPR anonymization). See PRIVACY_COMMITMENT.md.
const MIN_BUCKET = 5;
function suppressed(rows, labelKey) {
  return rows
    .map((r) => ({ label: r[labelKey], count: r._count._all }))
    .filter((r) => r.label && r.count >= MIN_BUCKET)
    .sort((a, b) => b.count - a.count);
}

// --- Listing subscription (contractor pays the platform to be listed) --------
//
// NOTE: The in-app construction-payment stack (homeowner deposits, milestone
// escrow, disputes, Stripe Connect payouts, refunds, earnings) was removed for
// CSLB compliance — a referral platform should not collect or hold payment for
// construction work (homeowners contract and pay the licensed contractor
// directly). The full implementation is preserved at git tag
// `pre-deposit-removal` / branch `deposit-feature-archive`. The subscription
// and boost below are platform advertising fees (Stripe Billing / a one-time
// charge), not construction payments, so they stay.

// POST /payments/pro/subscribe — start a hosted Checkout for the $10/mo listing
// subscription (includes Insights). If the business's free first month is still
// running, its end becomes the Stripe trial_end so they aren't billed early.
// Returns a URL the app opens in a web auth session.
router.post('/pro/subscribe', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const user = await db.user.findUnique({ where: { id: req.user.id } });
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });
    if (isProActive(business)) {
      return res.status(409).json({ error: 'You already have an active subscription' });
    }

    const session = await createProCheckoutSession({
      businessId: business.id,
      customerId: business.stripeCustomerId || undefined,
      customerEmail: user.email,
      trialEndsAt: business.freeListingEndsAt,
    });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// GET /payments/pro/status — the contractor's listing/subscription/boost state
// for the manage UI. `listed` is the bottom line: is this profile publicly
// visible right now?
router.get('/pro/status', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });
    const now = new Date();
    res.json({
      isPro: isProActive(business),
      status: business.proStatus || null,
      trialEndsAt: business.proTrialEndsAt,
      currentPeriodEnd: business.proCurrentPeriodEnd,
      listed: isListed(business, now),
      freeListingEndsAt: business.freeListingEndsAt,
      boostedUntil: business.boostedUntil,
      boostActive: Boolean(business.boostedUntil && business.boostedUntil > now),
    });
  } catch (err) {
    next(err);
  }
});

// POST /payments/boost — buy a 7-day Boost ($5 one-time). Limited slots per
// city, first-come: if the cap is full, 409 until someone's boost lapses.
router.post('/boost', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const user = await db.user.findUnique({ where: { id: req.user.id } });
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });

    // A hidden listing can't be boosted — the slot links to the public profile.
    if (!isListed(business)) {
      return res.status(409).json({ error: 'Your listing must be active to buy a Boost. Subscribe to get listed first.' });
    }

    // First-come slot cap per city. The business's own running boost doesn't
    // count against it (buying again just extends their week).
    const activeInCity = await db.business.count({
      where: {
        city: business.city,
        state: business.state,
        boostedUntil: { gt: new Date() },
        id: { not: business.id },
      },
    });
    if (activeInCity >= BOOST_CITY_CAP()) {
      return res.status(409).json({ error: 'All Boost slots in your area are taken right now. Try again when one opens up.' });
    }

    const session = await createBoostCheckoutSession({
      businessId: business.id,
      customerId: business.stripeCustomerId || undefined,
      customerEmail: user.email,
    });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// GET /payments/pro/insights — aggregated, de-identified market demand,
// included with the listing subscription. Every figure is a bucket of
// >= MIN_BUCKET; smaller buckets are suppressed so nothing maps to an
// individual. No homeowner PII is ever returned.
router.get('/pro/insights', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });
    if (!isProActive(business)) {
      return res.status(403).json({ error: 'Insights is included with the listing subscription' });
    }

    const [bySpecialty, byArea, estByType, sharedByType, leads] = await Promise.all([
      db.savedSearch.groupBy({ by: ['specialty'], _count: { _all: true }, where: { specialty: { not: null } } }),
      db.savedSearch.groupBy({ by: ['city', 'state'], _count: { _all: true }, where: { city: { not: null } } }),
      db.estimation.groupBy({ by: ['roomType'], _count: { _all: true }, where: { roomType: { not: null } } }),
      db.sharedEstimate.groupBy({ by: ['roomType'], _count: { _all: true }, where: { roomType: { not: null } } }),
      db.lead.findMany({ where: { businessId: business.id }, select: { status: true } }),
    ]);

    // Merge estimation + shared-estimate demand by room type.
    const typeTotals = {};
    for (const r of [...estByType, ...sharedByType]) {
      if (r.roomType) typeTotals[r.roomType] = (typeTotals[r.roomType] || 0) + r._count._all;
    }
    const demandByProjectType = Object.entries(typeTotals)
      .map(([label, count]) => ({ label, count }))
      .filter((r) => r.count >= MIN_BUCKET)
      .sort((a, b) => b.count - a.count);

    const totalLeads = leads.length;
    const converted = leads.filter((l) => l.status === 'CONVERTED').length;

    res.json({
      // Aggregated homeowner demand (de-identified, small buckets suppressed).
      demandByCategory: suppressed(bySpecialty, 'specialty'),
      demandByProjectType,
      demandByArea: suppressed(byArea.map((r) => ({ _count: r._count, label: `${r.city}, ${r.state || ''}`.trim().replace(/,\s*$/, '') })), 'label'),
      minBucket: MIN_BUCKET,
      // The contractor's own performance (their data, not customer PII).
      performance: {
        profileViews: business.profileViews,
        searchImpressions: business.searchImpressions,
        totalLeads,
        conversionRate: totalLeads ? Math.round((converted / totalLeads) * 100) : 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /payments/pro/cancel — cancel at period end (keep access until paid through).
router.post('/pro/cancel', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });
    if (!business.proSubscriptionId) {
      return res.status(409).json({ error: 'No active subscription to cancel' });
    }
    await cancelProSubscription(business.proSubscriptionId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
