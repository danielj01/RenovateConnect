const router = require('express').Router();
const Stripe = require('stripe');
const db = require('../services/db');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Raw body needed for Stripe signature verification
router.post('/stripe', require('express').raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).send('Webhook signature verification failed');
  }

  try {
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      if (invoice.subscription) {
        const sub = await stripe.subscriptions.retrieve(invoice.subscription);
        await db.business.updateMany({
          where: { stripeSubId: invoice.subscription },
          data: {
            isPromoted: true,
            promotedUntil: new Date(sub.current_period_end * 1000),
          },
        });
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await db.business.updateMany({
        where: { stripeSubId: sub.id },
        data: { isPromoted: false, promotedUntil: null, stripeSubId: null },
      });
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
