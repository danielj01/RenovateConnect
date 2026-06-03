const router = require('express').Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const db = require('../services/db');
const { createOrRetrieveCustomer, createSubscriptionCheckoutSession, cancelSubscription } = require('../services/stripe');

// POST /advertising/subscribe — start hosted Checkout for the promoted listing.
// Returns a Stripe-hosted URL the app opens in a web auth session; Stripe
// collects the card and starts the subscription, and the webhook flips
// isPromoted once the first invoice is paid.
router.post('/subscribe', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const user = await db.user.findUnique({ where: { id: req.user.id } });
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });
    if (business.isPromoted) return res.status(409).json({ error: 'Already subscribed' });

    // Reuse an existing Stripe customer so cards/leads stay on one record.
    let customerId = business.stripeCustomerId;
    if (!customerId) {
      const customer = await createOrRetrieveCustomer(user.email, user.name);
      customerId = customer.id;
      await db.business.update({
        where: { id: business.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await createSubscriptionCheckoutSession(customerId);
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// DELETE /advertising/subscribe — cancel promoted listing
router.delete('/subscribe', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business?.stripeSubId) return res.status(404).json({ error: 'No active subscription' });

    await cancelSubscription(business.stripeSubId);
    await db.business.update({
      where: { id: business.id },
      data: { isPromoted: false, promotedUntil: null, stripeSubId: null },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /advertising/status
router.get('/status', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({
      where: { userId: req.user.id },
      select: { isPromoted: true, promotedUntil: true, stripeSubId: true },
    });
    res.json(business ?? { isPromoted: false });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
