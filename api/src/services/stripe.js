const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// In-app deposit economics (Option A).
//   DEPOSIT_PERCENT   — the deposit is this % of the quote midpoint…
//   DEPOSIT_MIN_CENTS — …but never below this floor (so tiny jobs still clear fees)
//   COMMISSION_BPS    — the platform's cut, in basis points (800 = 8%)
const DEPOSIT_PERCENT = () => parseInt(process.env.DEPOSIT_PERCENT || '10', 10);
const DEPOSIT_MIN_CENTS = () => parseInt(process.env.DEPOSIT_MIN_CENTS || '5000', 10);
const COMMISSION_BPS = () => parseInt(process.env.COMMISSION_BPS || '800', 10);

// The deposit the contractor receives, derived from the accepted quote's
// midpoint (dollars in → cents out), floored at DEPOSIT_MIN_CENTS.
function depositCentsFor(quoteLow, quoteHigh) {
  const midDollars = ((quoteLow || 0) + (quoteHigh || 0)) / 2;
  const pctCents = Math.round(midDollars * 100 * (DEPOSIT_PERCENT() / 100));
  return Math.max(DEPOSIT_MIN_CENTS(), pctCents);
}

// The platform commission for a given deposit. Charged as a fee on top, so this
// is added to what the homeowner pays and becomes the Stripe application fee.
function commissionCentsFor(depositCents) {
  return Math.round(depositCents * (COMMISSION_BPS() / 10000));
}

// Where Stripe sends the user back after a hosted Checkout flow. The app opens
// these via a web auth session and closes on the success/cancel redirect.
const APP_BASE_URL = () => process.env.APP_BASE_URL || 'https://renovateconnect.app';

// Thin wrapper so route/handler code can verify webhook signatures without
// importing the Stripe SDK directly (keeps everything mockable in tests).
function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

// --- Stripe Connect (in-app deposits) ----------------------------------------

// Create an Express connected account for a contractor so they can receive
// deposit payouts. Express accounts use Stripe-hosted onboarding (bank, tax,
// identity), mirroring how we use hosted Checkout elsewhere.
async function createConnectAccount(email) {
  return stripe.accounts.create({
    type: 'express',
    email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });
}

// A one-time, expiring onboarding URL for a connected account. The app opens it
// in a web auth session; Stripe redirects back to APP_BASE_URL when done.
async function createAccountOnboardingLink(accountId) {
  return stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: `${APP_BASE_URL()}/connect/return?status=refresh`,
    return_url: `${APP_BASE_URL()}/connect/return?status=success`,
  });
}

async function retrieveAccount(accountId) {
  return stripe.accounts.retrieve(accountId);
}

// A hosted Checkout session (payment mode) for a deposit — a destination charge
// opened in an in-app Safari view, like the rest of our Stripe flows. The
// homeowner is charged `amountCents` (deposit + commission); `commissionCents`
// is split to the platform as the application fee and the remainder transfers to
// the contractor's connected account. The `metadata.paymentId` lets the
// checkout.session.completed webhook settle the matching Payment row.
async function createDepositCheckoutSession({
  amountCents,
  commissionCents,
  connectedAccountId,
  customerEmail,
  description,
  metadata,
}) {
  return stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: customerEmail || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        product_data: { name: description || 'Deposit' },
        unit_amount: amountCents,
      },
    }],
    payment_intent_data: {
      application_fee_amount: commissionCents,
      transfer_data: { destination: connectedAccountId },
      metadata: metadata || {},
    },
    metadata: metadata || {},
    success_url: `${APP_BASE_URL()}/billing/return?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_BASE_URL()}/billing/return?status=cancel`,
  });
}

// --- Milestone escrow (separate charges + transfers) -------------------------
//
// Unlike a deposit (a destination charge that pays out immediately), a milestone
// is true escrow: the homeowner's payment lands in the *platform* balance and is
// held until release. So funding uses a plain charge (no transfer_data), and
// release is a separate transfer to the contractor. The platform keeps the
// commission; the contractor receives `amountCents`.

// Hosted Checkout to fund a milestone. Charges the homeowner the full
// `totalCents` (milestone amount + commission) onto the platform balance — no
// transfer yet. `metadata.paymentId` lets the webhook settle the Payment row and
// flip the milestone to FUNDED.
async function createMilestoneCheckoutSession({
  totalCents,
  customerEmail,
  description,
  metadata,
}) {
  return stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: customerEmail || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        product_data: { name: description || 'Milestone payment' },
        unit_amount: totalCents,
      },
    }],
    payment_intent_data: { metadata: metadata || {} }, // held on platform
    metadata: metadata || {},
    success_url: `${APP_BASE_URL()}/billing/return?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_BASE_URL()}/billing/return?status=cancel`,
  });
}

// Release a funded milestone: transfer the contractor's portion from the held
// platform balance to their connected account. The commission stays behind.
async function createMilestoneTransfer({ amountCents, connectedAccountId, metadata }) {
  return stripe.transfers.create({
    amount: amountCents,
    currency: 'usd',
    destination: connectedAccountId,
    metadata: metadata || {},
  });
}

// Refund a funded-but-unreleased milestone. No transfer has happened yet, so a
// plain refund returns the full charge to the homeowner from the platform.
async function createMilestoneRefund(paymentIntentId) {
  return stripe.refunds.create({ payment_intent: paymentIntentId });
}

// Fully refund a deposit and unwind everyone's cut. For a destination charge a
// plain refund pulls only from the platform balance and leaves the contractor's
// transfer + our application fee in place — so we set:
//   reverse_transfer: true        — claw the contractor's payout back
//   refund_application_fee: true  — return our commission too
// Net effect: the homeowner is made whole and no one keeps any money.
async function createRefund(paymentIntentId) {
  return stripe.refunds.create({
    payment_intent: paymentIntentId,
    reverse_transfer: true,
    refund_application_fee: true,
  });
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
  // Connect / deposits
  depositCentsFor,
  commissionCentsFor,
  createConnectAccount,
  createAccountOnboardingLink,
  retrieveAccount,
  createDepositCheckoutSession,
  createRefund,
  // Milestone escrow
  createMilestoneCheckoutSession,
  createMilestoneTransfer,
  createMilestoneRefund,
  // Pro subscription
  createProCheckoutSession,
  cancelProSubscription,
};
