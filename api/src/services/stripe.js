const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const LEAD_FEE_CENTS = () => parseInt(process.env.LEAD_FEE_CENTS || '2500', 10);
const PROMOTED_MONTHLY_CENTS = () => parseInt(process.env.PROMOTED_MONTHLY_CENTS || '9900', 10);

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

async function createOrRetrieveCustomer(email, name) {
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data.length > 0) return existing.data[0];
  return stripe.customers.create({ email, name });
}

// Hosted Checkout in `setup` mode — captures a card without charging it, so we
// can bill accrued lead fees off-session at month-end. The saved payment method
// is promoted to the customer's default in the webhook once Checkout completes.
async function createSetupCheckoutSession(stripeCustomerId) {
  return stripe.checkout.sessions.create({
    mode: 'setup',
    customer: stripeCustomerId,
    payment_method_types: ['card'],
    success_url: `${APP_BASE_URL()}/billing/return?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_BASE_URL()}/billing/return?status=cancel`,
  });
}

// Hosted Checkout in `subscription` mode for the promoted-listing plan. Stripe
// collects the card and starts the subscription; the webhook flips isPromoted.
async function createSubscriptionCheckoutSession(stripeCustomerId) {
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    payment_method_types: ['card'],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        product_data: { name: 'RenovateConnect Promoted Listing' },
        unit_amount: PROMOTED_MONTHLY_CENTS(),
        recurring: { interval: 'month' },
      },
    }],
    success_url: `${APP_BASE_URL()}/billing/return?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_BASE_URL()}/billing/return?status=cancel`,
  });
}

// Pull the brand + last4 of the card a completed setup Checkout saved, and set
// it as the customer's default for invoices. Returns { brand, last4 } or null.
async function getSessionCard(session) {
  const setupIntentId = typeof session.setup_intent === 'string'
    ? session.setup_intent
    : session.setup_intent?.id;
  if (!setupIntentId) return null;

  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  const pmId = setupIntent.payment_method;
  if (!pmId) return null;

  const pm = await stripe.paymentMethods.retrieve(pmId);
  // Make this card the default for off-session invoice payments.
  if (session.customer) {
    await stripe.customers.update(session.customer, {
      invoice_settings: { default_payment_method: pmId },
    });
  }
  return pm.card ? { brand: pm.card.brand, last4: pm.card.last4 } : null;
}

// Add a single accrued lead fee to a customer's upcoming invoice (one per lead).
async function createLeadInvoiceItem(stripeCustomerId, businessName) {
  return stripe.invoiceItems.create({
    customer: stripeCustomerId,
    amount: LEAD_FEE_CENTS(),
    currency: 'usd',
    description: `RenovateConnect lead fee — ${businessName}`,
  });
}

// Draft, finalize, and charge an invoice for whatever invoice items are pending
// on the customer. Returns the paid (or attempted) invoice.
async function finalizeAndPayInvoice(stripeCustomerId) {
  const invoice = await stripe.invoices.create({
    customer: stripeCustomerId,
    auto_advance: true,
    collection_method: 'charge_automatically',
  });
  await stripe.invoices.finalizeInvoice(invoice.id);
  return stripe.invoices.pay(invoice.id);
}

async function retrieveSubscription(subId) {
  return stripe.subscriptions.retrieve(subId);
}

async function cancelSubscription(subId) {
  return stripe.subscriptions.cancel(subId);
}

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

async function createRefund(paymentIntentId) {
  return stripe.refunds.create({ payment_intent: paymentIntentId });
}

// Legacy alias kept for any callers still expecting the old name.
const createLeadCharge = createLeadInvoiceItem;

module.exports = {
  createOrRetrieveCustomer,
  createSetupCheckoutSession,
  createSubscriptionCheckoutSession,
  getSessionCard,
  createLeadInvoiceItem,
  createLeadCharge,
  finalizeAndPayInvoice,
  retrieveSubscription,
  cancelSubscription,
  constructWebhookEvent,
  // Connect / deposits
  depositCentsFor,
  commissionCentsFor,
  createConnectAccount,
  createAccountOnboardingLink,
  retrieveAccount,
  createDepositCheckoutSession,
  createRefund,
};
