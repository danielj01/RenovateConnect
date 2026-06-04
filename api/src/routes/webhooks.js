const router = require('express').Router();
const db = require('../services/db');
const { constructWebhookEvent } = require('../services/stripe');
const { recordActivity } = require('../services/activity');
const { sendPush } = require('../services/push');

// Apply a verified Stripe event to our DB. Pulled out of the route so it can be
// unit-tested directly with the Stripe service mocked. Handles:
//   - checkout.session.completed (deposit)       → settle Payment + capture intent id
//   - account.updated (Connect)                  → sync charges/payouts enabled
//   - payment_intent.succeeded (deposit)         → mark Payment SUCCEEDED + paid
//   - payment_intent.payment_failed (deposit)    → mark Payment FAILED
//   - charge.refunded (deposit)                  → mark Payment REFUNDED
async function handleStripeEvent(event, { db: database = db } = {}) {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // A homeowner's deposit checkout completed: settle the matching Payment and
    // capture the underlying payment_intent id (so a later refund can match).
    if (session.mode === 'payment' && session.metadata && session.metadata.paymentId) {
      const intentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
      await database.payment.updateMany({
        where: { id: session.metadata.paymentId },
        data: {
          status: 'SUCCEEDED',
          paidAt: new Date(),
          ...(intentId ? { stripePaymentIntentId: intentId } : {}),
        },
      });
    }
    return;
  }

  // --- Stripe Connect / in-app deposits --------------------------------------

  // A connected account's capabilities changed (finished onboarding, bank
  // verified, etc.). Mirror the payout-readiness flags onto the business.
  if (event.type === 'account.updated') {
    const account = event.data.object;
    await database.business.updateMany({
      where: { stripeAccountId: account.id },
      data: {
        chargesEnabled: !!account.charges_enabled,
        payoutsEnabled: !!account.payouts_enabled,
      },
    });
    return;
  }

  // The homeowner's deposit cleared: funds routed, commission collected. This is
  // both our revenue event and our proof the job is real.
  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    await database.payment.updateMany({
      where: { stripePaymentIntentId: intent.id },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });
    return;
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object;
    await database.payment.updateMany({
      where: { stripePaymentIntentId: intent.id },
      data: { status: 'FAILED' },
    });
    return;
  }

  // A deposit was refunded (cancellation/dispute). The charge carries the
  // originating payment_intent id, which is how we keyed the Payment row.
  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    const intentId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;
    if (intentId) {
      await database.payment.updateMany({
        where: { stripePaymentIntentId: intentId },
        data: { status: 'REFUNDED', refundedAt: new Date() },
      });

      // Let the homeowner know their deposit came back — a refund is otherwise
      // silent. Durable feed entry + best-effort push.
      const payment = await database.payment.findFirst({
        where: { stripePaymentIntentId: intentId },
        include: { business: { select: { companyName: true } } },
      });
      if (payment && payment.clientId) {
        const amount = `$${(payment.amountCents / 100).toFixed(2)}`;
        const company = payment.business?.companyName || 'the contractor';
        const body = `Your ${amount} deposit to ${company} has been refunded.`;
        const data = {
          paymentId: payment.id,
          ...(payment.quoteRequestId ? { quoteId: payment.quoteRequestId } : {}),
          ...(payment.businessId ? { businessId: payment.businessId } : {}),
        };
        sendPush(payment.clientId, {
          type: 'PAYMENT',
          title: 'Deposit refunded 💸',
          body,
          data,
        }).catch(console.error);
        await recordActivity(payment.clientId, {
          type: 'PAYMENT',
          title: 'Deposit refunded',
          body,
          data,
        });
      }
    }
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
