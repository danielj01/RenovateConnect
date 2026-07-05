const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// NOTE: The in-app construction-payment stack (homeowner deposits, milestone
// escrow, Stripe Connect payouts, refunds) was removed for CSLB compliance —
// homeowners contract with and pay the licensed contractor directly, not
// through the platform. The full implementation (depositCentsFor, Connect
// onboarding, milestone escrow charges/transfers, refunds) is preserved at git
// tag `pre-deposit-removal` / branch `deposit-feature-archive`. Only the "Pro"
// subscription below remains — that is a platform subscription (Stripe
// Billing), not a payment for construction work.

// Where Stripe sends the user back after a hosted Checkout flow. The app opens
// these via a web auth session and closes on the success/cancel redirect.
const APP_BASE_URL = () => process.env.APP_BASE_URL || 'https://renovateconnect.app';

// Thin wrapper so route/handler code can verify webhook signatures without
// importing the Stripe SDK directly (keeps everything mockable in tests).
function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

// --- Listing subscription (contractor pays the platform to be listed) --------
//
// A normal recurring subscription billed TO the contractor BY the platform —
// NOT a Connect charge. One plan: $10/mo, includes the Insights dashboard.
// The free first month is NOT a Stripe trial — it's freeListingEndsAt on the
// business (stamped at admin approval). When a contractor subscribes while
// their free month is still running, we pass its end as the Stripe trial_end
// so they're never billed for time they already had free. Checkout requires
// trial_end >= 48h out; anything closer just bills immediately.
// `payment_method_collection: 'if_required'` lets a trial-carrying checkout
// complete without a card; Stripe collects one before the trial ends.

const PRO_PRICE_CENTS = () => parseInt(process.env.PRO_PRICE_CENTS || '1000', 10);
const BOOST_PRICE_CENTS = () => parseInt(process.env.BOOST_PRICE_CENTS || '500', 10);
const BOOST_DURATION_DAYS = () => parseInt(process.env.BOOST_DURATION_DAYS || '7', 10);

async function createProCheckoutSession({ businessId, customerId, customerEmail, trialEndsAt }) {
  const trialEnd = trialEndsAt && trialEndsAt.getTime() > Date.now() + 48 * 60 * 60 * 1000
    ? Math.floor(trialEndsAt.getTime() / 1000)
    : undefined;
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    ...(customerId ? { customer: customerId } : { customer_email: customerEmail || undefined }),
    payment_method_collection: 'if_required',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        product_data: { name: 'RenovateConnect listing subscription' },
        unit_amount: PRO_PRICE_CENTS(),
        recurring: { interval: 'month' },
      },
    }],
    subscription_data: {
      ...(trialEnd ? { trial_end: trialEnd } : {}),
      metadata: { businessId },
    },
    client_reference_id: businessId,
    metadata: { businessId, kind: 'pro_subscription' },
    success_url: `${APP_BASE_URL()}/billing/return?status=success&pro=1`,
    cancel_url: `${APP_BASE_URL()}/billing/return?status=cancel`,
  });
}

// --- Boost (one-time $5 payment for a week in the labeled top slot) ----------
//
// mode: 'payment' — a single charge, no subscription. The webhook activates
// the boost when checkout.session.completed arrives with kind: 'boost'.
async function createBoostCheckoutSession({ businessId, customerId, customerEmail }) {
  return stripe.checkout.sessions.create({
    mode: 'payment',
    ...(customerId ? { customer: customerId } : { customer_email: customerEmail || undefined }),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        product_data: { name: `RenovateConnect Boost — top of search for ${BOOST_DURATION_DAYS()} days` },
        unit_amount: BOOST_PRICE_CENTS(),
      },
    }],
    client_reference_id: businessId,
    metadata: { businessId, kind: 'boost' },
    success_url: `${APP_BASE_URL()}/billing/return?status=success&boost=1`,
    cancel_url: `${APP_BASE_URL()}/billing/return?status=cancel`,
  });
}

// Cancel at period end so the contractor keeps Pro until they've paid through.
async function cancelProSubscription(subscriptionId) {
  return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
}

module.exports = {
  constructWebhookEvent,
  // Listing subscription
  createProCheckoutSession,
  cancelProSubscription,
  // Boost
  createBoostCheckoutSession,
  BOOST_PRICE_CENTS,
  BOOST_DURATION_DAYS,
};
