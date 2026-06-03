const db = require('./db');
const stripe = require('./stripe');

// End-of-month lead-fee billing.
//
// Leads accrue all month as `billed: false` rows. This run, intended to be
// triggered by a monthly cron (or the admin endpoint), groups unbilled leads by
// business and, for each business that has both a saved Stripe customer and at
// least one unbilled lead:
//   1. adds one invoice item per lead to their upcoming invoice
//   2. finalizes + charges a single invoice for the month
//   3. marks those exact leads billed (so a re-run is idempotent)
//
// We mark the leads billed only *after* the invoice is created, and we capture
// the lead ids up front so leads created mid-run aren't swept into this cycle.
// A business with no Stripe customer is skipped (their leads stay unbilled until
// they add a card) and reported so the caller/admin can see who's unbilled.
async function runMonthlyBilling({ db: database = db, stripe: payments = stripe } = {}) {
  const unbilled = await database.lead.findMany({
    where: { billed: false },
    select: { id: true, businessId: true },
  });

  // Group lead ids by business.
  const byBusiness = new Map();
  for (const lead of unbilled) {
    if (!byBusiness.has(lead.businessId)) byBusiness.set(lead.businessId, []);
    byBusiness.get(lead.businessId).push(lead.id);
  }

  const result = {
    businessesBilled: 0,
    leadsBilled: 0,
    invoices: [],
    skipped: [],
  };

  for (const [businessId, leadIds] of byBusiness) {
    const business = await database.business.findUnique({
      where: { id: businessId },
      select: { id: true, companyName: true, stripeCustomerId: true },
    });

    if (!business || !business.stripeCustomerId) {
      result.skipped.push({ businessId, leadCount: leadIds.length, reason: 'no-payment-method' });
      continue;
    }

    try {
      // One invoice item per lead keeps the invoice line-itemized and auditable.
      for (let i = 0; i < leadIds.length; i += 1) {
        await payments.createLeadInvoiceItem(business.stripeCustomerId, business.companyName);
      }
      const invoice = await payments.finalizeAndPayInvoice(business.stripeCustomerId);

      await database.lead.updateMany({
        where: { id: { in: leadIds } },
        data: { billed: true, billedAt: new Date() },
      });

      result.businessesBilled += 1;
      result.leadsBilled += leadIds.length;
      result.invoices.push({
        businessId,
        leadCount: leadIds.length,
        invoiceId: invoice?.id ?? null,
      });
    } catch (err) {
      // Leave these leads unbilled so the next run retries them.
      result.skipped.push({ businessId, leadCount: leadIds.length, reason: 'charge-failed', error: err.message });
    }
  }

  return result;
}

module.exports = { runMonthlyBilling };
