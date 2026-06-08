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
    ...(sub.metadata && sub.metadata.plan ? { proPlan: sub.metadata.plan } : {}),
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

    // Pro subscription checkout completed: link the customer + subscription to
    // the business immediately (status is finalized by the subscription.* events).
    if (session.mode === 'subscription' && session.metadata && session.metadata.businessId) {
      await database.business.updateMany({
        where: { id: session.metadata.businessId },
        data: {
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
          proSubscriptionId: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id,
          proStatus: 'trialing',
          ...(session.metadata.plan ? { proPlan: session.metadata.plan } : {}),
        },
      });
      return;
    }

    // A homeowner's deposit checkout completed: settle the matching Payment and
    // capture the underlying payment_intent id (so a later refund can match).
    if (session.mode === 'payment' && session.metadata && session.metadata.paymentId) {
      const intentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
      // Never resurrect a refunded deposit: both this event and
      // payment_intent.succeeded settle the same Payment, and a delayed/replayed
      // event must not flip a REFUNDED row back to SUCCEEDED.
      await database.payment.updateMany({
        where: { id: session.metadata.paymentId, status: { not: 'REFUNDED' } },
        data: {
          status: 'SUCCEEDED',
          paidAt: new Date(),
          ...(intentId ? { stripePaymentIntentId: intentId } : {}),
        },
      });

      // Milestone funding: the held charge cleared → mark the milestone FUNDED
      // (escrow holds the money until the homeowner releases it). Guard against
      // a replayed event clobbering a later state (SUBMITTED/APPROVED/REFUNDED).
      if (session.metadata.milestoneId) {
        const funded = await database.milestone.updateMany({
          where: { id: session.metadata.milestoneId, status: 'PENDING' },
          data: { status: 'FUNDED', fundedAt: new Date() },
        });

        // Only on the real PENDING→FUNDED transition (not a replayed event), tell
        // the contractor money is in escrow so they can start the work.
        if (funded.count > 0) {
          const milestone = await database.milestone.findUnique({
            where: { id: session.metadata.milestoneId },
            include: { project: { include: { business: { select: { userId: true } } } } },
          });
          const ownerId = milestone?.project?.business?.userId;
          if (ownerId) {
            const amount = `$${(milestone.amountCents / 100).toLocaleString()}`;
            const body = `The homeowner funded "${milestone.title}" (${amount}). It's held in escrow — finish the work and submit it to get paid.`;
            const data = { projectId: milestone.projectId, businessId: milestone.project.businessId };
            sendPush(ownerId, { type: 'PAYMENT', title: 'Milestone funded 🔒', body, data }).catch(console.error);
            await recordActivity(ownerId, { type: 'PAYMENT', title: 'Milestone funded', body, data });
          }
        }
      }
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
    // Same guard as checkout.session.completed: a replayed/late success must
    // never overwrite a deposit we've already refunded.
    await database.payment.updateMany({
      where: { stripePaymentIntentId: intent.id, status: { not: 'REFUNDED' } },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });
    return;
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object;
    // Don't let a stale failure clobber a deposit that already succeeded or was
    // refunded (e.g. retry succeeded, then a failed event for an earlier attempt
    // arrives out of order).
    await database.payment.updateMany({
      where: { stripePaymentIntentId: intent.id, status: { notIn: ['SUCCEEDED', 'REFUNDED'] } },
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

      // Milestone funding refunded → reflect it on the milestone so escrow state
      // stays consistent (a refunded milestone returns to the homeowner).
      if (payment?.milestoneId) {
        await database.milestone.updateMany({
          where: { id: payment.milestoneId, status: { in: ['FUNDED', 'SUBMITTED'] } },
          data: { status: 'REFUNDED' },
        });
      }
      if (payment && payment.clientId) {
        const amount = `$${(payment.amountCents / 100).toFixed(2)}`;
        const company = payment.business?.companyName || 'the contractor';
        // Milestone refunds and deposit refunds share this path; word it for
        // whichever this charge was.
        const isMilestone = !!payment.milestoneId;
        const noun = isMilestone ? 'milestone payment' : 'deposit';
        const body = `Your ${amount} ${noun} to ${company} has been refunded.`;
        const title = isMilestone ? 'Milestone refunded 💸' : 'Deposit refunded 💸';
        const data = {
          paymentId: payment.id,
          ...(payment.quoteRequestId ? { quoteId: payment.quoteRequestId } : {}),
          ...(payment.businessId ? { businessId: payment.businessId } : {}),
        };
        sendPush(payment.clientId, {
          type: 'PAYMENT',
          title,
          body,
          data,
        }).catch(console.error);
        await recordActivity(payment.clientId, {
          type: 'PAYMENT',
          title: isMilestone ? 'Milestone refunded' : 'Deposit refunded',
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
