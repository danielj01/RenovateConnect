const router = require('express').Router();
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const {
  createOrRetrieveCustomer,
  createSetupCheckoutSession,
} = require('../services/stripe');
const { runMonthlyBilling } = require('../services/billing');

const LEAD_FEE_CENTS = () => parseInt(process.env.LEAD_FEE_CENTS || '2500', 10);

// POST /billing/setup-card — start a hosted Checkout (setup mode) so the
// business can save a card on file. Returns a Stripe-hosted URL the app opens
// in a web auth session. The saved card is captured + stored via webhook.
router.post('/setup-card', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const user = await db.user.findUnique({ where: { id: req.user.id } });
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });

    // Reuse the existing Stripe customer if we have one, otherwise create it now
    // so the setup session attaches the card to a stable customer.
    let customerId = business.stripeCustomerId;
    if (!customerId) {
      const customer = await createOrRetrieveCustomer(user.email, user.name);
      customerId = customer.id;
      await db.business.update({
        where: { id: business.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await createSetupCheckoutSession(customerId);
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// GET /billing/summary — what the business owes and how it'll be paid. Surfaces
// the saved card, promoted-plan status, and this month's accrued (unbilled)
// lead fees so the app can render a billing dashboard.
router.get('/summary', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({
      where: { userId: req.user.id },
      select: {
        id: true,
        isPromoted: true,
        promotedUntil: true,
        cardBrand: true,
        cardLast4: true,
        stripeCustomerId: true,
      },
    });
    if (!business) return res.status(404).json({ error: 'No business profile found' });

    const unbilledCount = await db.lead.count({
      where: { businessId: business.id, billed: false },
    });
    const feeCents = LEAD_FEE_CENTS();

    res.json({
      isPromoted: business.isPromoted,
      promotedUntil: business.promotedUntil,
      card: business.cardLast4
        ? { brand: business.cardBrand, last4: business.cardLast4 }
        : null,
      hasPaymentMethod: !!business.cardLast4,
      leadFeeCents: feeCents,
      unbilledLeads: unbilledCount,
      unbilledAmountCents: unbilledCount * feeCents,
    });
  } catch (err) {
    next(err);
  }
});

// POST /billing/run-monthly — admin-only trigger for the month-end lead-fee run.
// Normally invoked by a scheduled job; exposed here for manual runs + tests.
router.post('/run-monthly', authMiddleware, requireRole('ADMIN'), async (_req, res, next) => {
  try {
    const summary = await runMonthlyBilling();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
