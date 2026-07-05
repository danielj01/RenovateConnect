const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const {
  createProCheckoutSession,
  cancelProSubscription,
} = require('../services/stripe');

// A business counts as "Pro" (eligible for the Sponsored slot) while trialing or
// actively paying.
const PRO_ACTIVE_STATUSES = ['trialing', 'active'];
function isProActive(business) {
  return PRO_ACTIVE_STATUSES.includes(business?.proStatus);
}
// Insights ($10) is the higher tier; it includes the Sponsored slot.
function hasInsights(business) {
  return isProActive(business) && business?.proPlan === 'insights';
}

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

// --- Pro subscription (contractor pays the platform) -------------------------
//
// NOTE: The in-app construction-payment stack (homeowner deposits, milestone
// escrow, disputes, Stripe Connect payouts, refunds, earnings) was removed for
// CSLB compliance — a referral platform should not collect or hold payment for
// construction work (homeowners contract and pay the licensed contractor
// directly). The full implementation is preserved at git tag
// `pre-deposit-removal` / branch `deposit-feature-archive`. Pro subscription
// below is a platform subscription (Stripe Billing), not a construction
// payment, so it stays.

// POST /payments/pro/subscribe — start a hosted Checkout for the $5/mo Pro plan
// (90-day free trial). Returns a URL the app opens in a web auth session.
router.post('/pro/subscribe', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const { plan } = z.object({
      plan: z.enum(['sponsored', 'insights']).optional(),
    }).strict().parse(req.body || {});
    const user = await db.user.findUnique({ where: { id: req.user.id } });
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });
    if (isProActive(business)) {
      return res.status(409).json({ error: 'You already have an active Pro subscription' });
    }

    const session = await createProCheckoutSession({
      businessId: business.id,
      customerId: business.stripeCustomerId || undefined,
      customerEmail: user.email,
      plan: plan || 'sponsored',
    });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// GET /payments/pro/status — the contractor's Pro state for the upsell/manage UI.
router.get('/pro/status', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });
    res.json({
      isPro: isProActive(business),
      plan: business.proPlan || null,
      hasInsights: hasInsights(business),
      status: business.proStatus || null,
      trialEndsAt: business.proTrialEndsAt,
      currentPeriodEnd: business.proCurrentPeriodEnd,
    });
  } catch (err) {
    next(err);
  }
});

// GET /payments/pro/insights — aggregated, de-identified market demand for the
// Insights tier. Every figure is a bucket of >= MIN_BUCKET; smaller buckets are
// suppressed so nothing maps to an individual. No homeowner PII is ever returned.
router.get('/pro/insights', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });
    if (!hasInsights(business)) {
      return res.status(403).json({ error: 'Insights requires the Pro Insights plan' });
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
