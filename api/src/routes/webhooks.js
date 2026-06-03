const router = require('express').Router();
const db = require('../services/db');
const {
  getSessionCard,
  retrieveSubscription,
  constructWebhookEvent,
} = require('../services/stripe');

// Apply a verified Stripe event to our DB. Pulled out of the route so it can be
// unit-tested directly with the Stripe service mocked. Handles:
//   - checkout.session.completed (setup)        → save card brand/last4
//   - checkout.session.completed (subscription) → store the subscription id
//   - invoice.payment_succeeded (subscription)  → flip isPromoted + extend until
//   - customer.subscription.deleted             → unset promoted state
async function handleStripeEvent(event, { db: database = db, stripe: payments = { getSessionCard, retrieveSubscription } } = {}) {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    if (session.mode === 'setup') {
      const card = await payments.getSessionCard(session);
      if (card && session.customer) {
        await database.business.updateMany({
          where: { stripeCustomerId: session.customer },
          data: { cardBrand: card.brand, cardLast4: card.last4 },
        });
      }
    }

    if (session.mode === 'subscription' && session.subscription && session.customer) {
      await database.business.updateMany({
        where: { stripeCustomerId: session.customer },
        data: { stripeSubId: session.subscription },
      });
    }
    return;
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    if (invoice.subscription) {
      const sub = await payments.retrieveSubscription(invoice.subscription);
      await database.business.updateMany({
        where: { stripeSubId: invoice.subscription },
        data: {
          isPromoted: true,
          promotedUntil: new Date(sub.current_period_end * 1000),
        },
      });
    }
    return;
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    await database.business.updateMany({
      where: { stripeSubId: sub.id },
      data: { isPromoted: false, promotedUntil: null, stripeSubId: null },
    });
  }
}

// Raw body needed for Stripe signature verification.
router.post('/stripe', require('express').raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = constructWebhookEvent(req.body, sig);
  } catch {
    return res.status(400).send('Webhook signature verification failed');
  }

  try {
    await handleStripeEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
module.exports.handleStripeEvent = handleStripeEvent;
