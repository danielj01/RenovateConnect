const router = require('express').Router();
const db = require('../services/db');
const { constructWebhookEvent, BOOST_PRICE_CENTS, BOOST_DURATION_DAYS } = require('../services/stripe');

// Apply a verified Stripe event to our DB. Pulled out of the route so it can be
// unit-tested directly with the Stripe service mocked. Only the Pro subscription
// lifecycle is handled — the in-app construction-payment webhooks (deposit
// settlement, Connect account.updated, milestone escrow, refunds) were removed
// with the payment stack (preserved at tag `pre-deposit-removal`).
//
// Map a Stripe subscription object onto the owning business (matched by the
// businessId we stamped into subscription metadata at checkout). Mirrors status,
// trial end, and period end so search eligibility + the manage UI stay accurate.
async function applyProSubscription(database, sub) {
  const businessId = sub.metadata && sub.metadata.businessId;
  const toDate = (unix) => (unix ? new Date(unix * 1000) : null);
  const data = {
    proSubscriptionId: sub.id,
    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    proStatus: sub.status,
    proTrialEndsAt: toDate(sub.trial_end),
    proCurrentPeriodEnd: toDate(sub.current_period_end),
  };
  if (businessId) {
    await database.business.updateMany({ where: { id: businessId }, data });
  } else {
    // Fallback: match by the subscription id we previously stored.
    await database.business.updateMany({ where: { proSubscriptionId: sub.id }, data });
  }
}

async function handleStripeEvent(event, { db: database = db } = {}) {
  // --- Pro subscription lifecycle (contractor → platform) --------------------
  if (event.type === 'customer.subscription.created'
      || event.type === 'customer.subscription.updated') {
    await applyProSubscription(database, event.data.object);
    return;
  }
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    await database.business.updateMany({
      where: { proSubscriptionId: sub.id },
      data: { proStatus: 'canceled' },
    });
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Listing-subscription checkout completed: link the customer + subscription
    // to the business immediately (status is finalized by subscription.* events).
    if (session.mode === 'subscription' && session.metadata && session.metadata.businessId) {
      await database.business.updateMany({
        where: { id: session.metadata.businessId },
        data: {
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
          proSubscriptionId: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id,
          proStatus: 'trialing',
        },
      });
    }

    // Boost payment completed: record the boost week and extend the business's
    // denormalized boostedUntil. Buying while already boosted extends the run.
    if (session.mode === 'payment' && session.metadata && session.metadata.kind === 'boost'
        && session.metadata.businessId) {
      await activateBoost(database, session);
    }
  }
}

// Idempotent boost activation — the unique stripeSessionId means a replayed
// webhook can't double-extend.
async function activateBoost(database, session) {
  const businessId = session.metadata.businessId;
  const business = await database.business.findUnique({ where: { id: businessId } });
  if (!business) return;

  const now = new Date();
  const base = business.boostedUntil && business.boostedUntil > now ? business.boostedUntil : now;
  const endsAt = new Date(base.getTime() + BOOST_DURATION_DAYS() * 24 * 60 * 60 * 1000);

  try {
    await database.boost.create({
      data: {
        businessId,
        startsAt: now,
        endsAt,
        amountCents: session.amount_total ?? BOOST_PRICE_CENTS(),
        stripeSessionId: session.id,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') return; // replayed event — boost already applied
    throw err;
  }

  await database.business.update({
    where: { id: businessId },
    data: {
      boostedUntil: endsAt,
      ...(session.customer
        ? { stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id }
        : {}),
    },
  });
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
