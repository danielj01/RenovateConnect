const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

async function createLeadCharge(stripeCustomerId, businessName) {
  return stripe.invoiceItems.create({
    customer: stripeCustomerId,
    amount: parseInt(process.env.LEAD_FEE_CENTS || '2500', 10),
    currency: 'usd',
    description: `RenovateConnect lead fee — ${businessName}`,
  });
}

async function createOrRetrieveCustomer(email, name) {
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data.length > 0) return existing.data[0];
  return stripe.customers.create({ email, name });
}

async function createPromotedSubscription(stripeCustomerId) {
  return stripe.subscriptions.create({
    customer: stripeCustomerId,
    items: [{ price_data: {
      currency: 'usd',
      product_data: { name: 'RenovateConnect Promoted Listing' },
      unit_amount: parseInt(process.env.PROMOTED_MONTHLY_CENTS || '9900', 10),
      recurring: { interval: 'month' },
    }}],
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
  });
}

async function cancelSubscription(subId) {
  return stripe.subscriptions.cancel(subId);
}

module.exports = { createLeadCharge, createOrRetrieveCustomer, createPromotedSubscription, cancelSubscription };
