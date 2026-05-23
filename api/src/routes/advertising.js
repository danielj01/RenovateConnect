const router = require('express').Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const db = require('../services/db');
const { createOrRetrieveCustomer, createPromotedSubscription, cancelSubscription } = require('../services/stripe');

// POST /advertising/subscribe — business subscribes to promoted listing
router.post('/subscribe', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const user = await db.user.findUnique({ where: { id: req.user.id } });
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });
    if (business.isPromoted) return res.status(409).json({ error: 'Already subscribed' });

    const customer = await createOrRetrieveCustomer(user.email, user.name);
    const subscription = await createPromotedSubscription(customer.id);

    // Store Stripe IDs; isPromoted flips when webhook confirms payment
    await db.business.update({
      where: { id: business.id },
      data: { stripeCustomerId: customer.id, stripeSubId: subscription.id },
    });

    res.json({
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice?.payment_intent?.client_secret,
    });
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
