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

// --- "Pro" subscription (contractor pays the platform) ------------------------
//
// A normal recurring subscription billed TO the contractor BY the platform —
// NOT a Connect charge. $5/mo with a 90-day free trial. `payment_method_collection:
// 'if_required'` lets the trial start with no card, so signup is frictionless;
// Stripe collects a card before the trial ends. The subscription's businessId
// metadata lets the webhook map status changes back to the right business.

const PRO_PRICE_CENTS = () => parseInt(process.env.PRO_PRICE_CENTS || '500', 10);
const INSIGHTS_PRICE_CENTS = () => parseInt(process.env.INSIGHTS_PRICE_CENTS || '1000', 10);
const PRO_TRIAL_DAYS = () => parseInt(process.env.PRO_TRIAL_DAYS || '90', 10);

// Two tiers: "sponsored" ($5 — the labeled Sponsored slot) and "insights" ($10 —
// Sponsored slot + aggregated market insights). Insights is a strict superset.
function proPlanConfig(plan) {
  if (plan === 'insights') {
    return { plan: 'insights', name: 'RenovateConnect Pro — Insights', unitAmount: INSIGHTS_PRICE_CENTS() };
  }
  return { plan: 'sponsored', name: 'RenovateConnect Pro', unitAmount: PRO_PRICE_CENTS() };
}

async function createProCheckoutSession({ businessId, customerId, customerEmail, plan }) {
  const cfg = proPlanConfig(plan);
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    ...(customerId ? { customer: customerId } : { customer_email: customerEmail || undefined }),
    payment_method_collection: 'if_required',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        product_data: { name: cfg.name },
        unit_amount: cfg.unitAmount,
        recurring: { interval: 'month' },
      },
    }],
    subscription_data: {
      trial_period_days: PRO_TRIAL_DAYS(),
      metadata: { businessId, plan: cfg.plan },
    },
    client_reference_id: businessId,
    metadata: { businessId, plan: cfg.plan, kind: 'pro_subscription' },
    success_url: `${APP_BASE_URL()}/billing/return?status=success&pro=1`,
    cancel_url: `${APP_BASE_URL()}/billing/return?status=cancel`,
  });
}

// Cancel at period end so the contractor keeps Pro until they've paid through.
async function cancelProSubscription(subscriptionId) {
  return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
}

module.exports = {
  constructWebhookEvent,
  // Pro subscription
  createProCheckoutSession,
  cancelProSubscription,
};
