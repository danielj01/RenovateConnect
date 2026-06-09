const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const {
  depositCentsFor,
  commissionCentsFor,
  createConnectAccount,
  createAccountOnboardingLink,
  retrieveAccount,
  createDepositCheckoutSession,
  createRefund,
  createProCheckoutSession,
  cancelProSubscription,
} = require('../services/stripe');

// A business counts as "Pro" (eligible for the Sponsored slot) while trialing or
// actively paying.
const PRO_ACTIVE_STATUSES = ['trialing', 'active'];
function isProActive(business) {
  return PRO_ACTIVE_STATUSES.includes(business?.proStatus);
}
// Insights ($10) is the higher tier; it includes the Sponsored slot.
function hasInsights(business) {
  return isProActive(business) && business?.proPlan === 'insights';
}

// Aggregated demand is only shared in buckets of at least this many — small
// buckets are suppressed so nothing can be tied back to an individual/small
// group (CCPA de-identification / GDPR anonymization). See PRIVACY_COMMITMENT.md.
const MIN_BUCKET = 5;
function suppressed(rows, labelKey) {
  return rows
    .map((r) => ({ label: r[labelKey], count: r._count._all }))
    .filter((r) => r.label && r.count >= MIN_BUCKET)
    .sort((a, b) => b.count - a.count);
}

// --- Contractor onboarding (Stripe Connect) ----------------------------------

// POST /payments/connect/onboard — create (or reuse) the contractor's Express
// connected account and return a hosted onboarding URL. The app opens it in a
// web auth session; capability flags arrive later via the account.updated
// webhook (and can be synced on demand via GET /connect/status).
router.post('/connect/onboard', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const user = await db.user.findUnique({ where: { id: req.user.id } });
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });

    let accountId = business.stripeAccountId;
    if (!accountId) {
      const account = await createConnectAccount(user.email);
      accountId = account.id;
      await db.business.update({
        where: { id: business.id },
        data: { stripeAccountId: accountId },
      });
    }

    const link = await createAccountOnboardingLink(accountId);
    res.json({ url: link.url });
  } catch (err) {
    next(err);
  }
});

// GET /payments/connect/status — current payout readiness. If we have an
// account on file we refresh the capability flags from Stripe (so the UI is
// accurate right after onboarding, before the webhook lands), then persist them.
router.get('/connect/status', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });

    let { chargesEnabled, payoutsEnabled } = business;
    if (business.stripeAccountId) {
      const account = await retrieveAccount(business.stripeAccountId);
      chargesEnabled = !!account.charges_enabled;
      payoutsEnabled = !!account.payouts_enabled;
      await db.business.update({
        where: { id: business.id },
        data: { chargesEnabled, payoutsEnabled },
      });
    }

    res.json({
      onboarded: !!business.stripeAccountId,
      chargesEnabled,
      payoutsEnabled,
    });
  } catch (err) {
    next(err);
  }
});

// --- Pro subscription (contractor pays the platform) -------------------------

// POST /payments/pro/subscribe — start a hosted Checkout for the $5/mo Pro plan
// (90-day free trial). Returns a URL the app opens in a web auth session.
router.post('/pro/subscribe', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const { plan } = z.object({
      plan: z.enum(['sponsored', 'insights']).optional(),
    }).strict().parse(req.body || {});
    const user = await db.user.findUnique({ where: { id: req.user.id } });
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });
    if (isProActive(business)) {
      return res.status(409).json({ error: 'You already have an active Pro subscription' });
    }

    const session = await createProCheckoutSession({
      businessId: business.id,
      customerId: business.stripeCustomerId || undefined,
      customerEmail: user.email,
      plan: plan || 'sponsored',
    });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// GET /payments/pro/status — the contractor's Pro state for the upsell/manage UI.
router.get('/pro/status', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });
    res.json({
      isPro: isProActive(business),
      plan: business.proPlan || null,
      hasInsights: hasInsights(business),
      status: business.proStatus || null,
      trialEndsAt: business.proTrialEndsAt,
      currentPeriodEnd: business.proCurrentPeriodEnd,
    });
  } catch (err) {
    next(err);
  }
});

// GET /payments/pro/insights — aggregated, de-identified market demand for the
// Insights tier. Every figure is a bucket of >= MIN_BUCKET; smaller buckets are
// suppressed so nothing maps to an individual. No homeowner PII is ever returned.
router.get('/pro/insights', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });
    if (!hasInsights(business)) {
      return res.status(403).json({ error: 'Insights requires the Pro Insights plan' });
    }

    const [bySpecialty, byArea, estByType, sharedByType, leads] = await Promise.all([
      db.savedSearch.groupBy({ by: ['specialty'], _count: { _all: true }, where: { specialty: { not: null } } }),
      db.savedSearch.groupBy({ by: ['city', 'state'], _count: { _all: true }, where: { city: { not: null } } }),
      db.estimation.groupBy({ by: ['roomType'], _count: { _all: true }, where: { roomType: { not: null } } }),
      db.sharedEstimate.groupBy({ by: ['roomType'], _count: { _all: true }, where: { roomType: { not: null } } }),
      db.lead.findMany({ where: { businessId: business.id }, select: { status: true } }),
    ]);

    // Merge estimation + shared-estimate demand by room type.
    const typeTotals = {};
    for (const r of [...estByType, ...sharedByType]) {
      if (r.roomType) typeTotals[r.roomType] = (typeTotals[r.roomType] || 0) + r._count._all;
    }
    const demandByProjectType = Object.entries(typeTotals)
      .map(([label, count]) => ({ label, count }))
      .filter((r) => r.count >= MIN_BUCKET)
      .sort((a, b) => b.count - a.count);

    const totalLeads = leads.length;
    const converted = leads.filter((l) => l.status === 'CONVERTED').length;

    res.json({
      // Aggregated homeowner demand (de-identified, small buckets suppressed).
      demandByCategory: suppressed(bySpecialty, 'specialty'),
      demandByProjectType,
      demandByArea: suppressed(byArea.map((r) => ({ _count: r._count, label: `${r.city}, ${r.state || ''}`.trim().replace(/,\s*$/, '') })), 'label'),
      minBucket: MIN_BUCKET,
      // The contractor's own performance (their data, not customer PII).
      performance: {
        profileViews: business.profileViews,
        searchImpressions: business.searchImpressions,
        totalLeads,
        conversionRate: totalLeads ? Math.round((converted / totalLeads) * 100) : 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /payments/pro/cancel — cancel at period end (keep access until paid through).
router.post('/pro/cancel', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });
    if (!business.proSubscriptionId) {
      return res.status(409).json({ error: 'No active subscription to cancel' });
    }
    await cancelProSubscription(business.proSubscriptionId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- Homeowner deposit -------------------------------------------------------

// POST /payments/deposit — start a hosted Checkout for a deposit on an accepted
// quote. Returns a Stripe-hosted URL the app opens in a Safari view; the
// checkout.session.completed webhook settles the Payment row. Idempotent per
// quote: a quote has at most one Payment row (unique). A settled (SUCCEEDED)
// deposit can't be re-created; a PENDING/FAILED one is refreshed in place so an
// abandoned checkout can be retried.
router.post('/deposit', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const { quoteRequestId } = z.object({ quoteRequestId: z.string().min(1).max(64) }).strict().parse(req.body);

    const quote = await db.quoteRequest.findUnique({
      where: { id: quoteRequestId },
      include: {
        business: {
          select: {
            id: true, companyName: true, stripeAccountId: true, payoutsEnabled: true,
          },
        },
      },
    });
    if (!quote) return res.status(404).json({ error: 'Not found' });
    if (quote.clientId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (quote.status !== 'ACCEPTED') {
      return res.status(409).json({ error: 'You can only pay a deposit on an accepted quote.' });
    }
    if (!quote.business.stripeAccountId || !quote.business.payoutsEnabled) {
      return res.status(409).json({ error: 'This contractor can\'t accept in-app payments yet.' });
    }

    const existing = await db.payment.findUnique({ where: { quoteRequestId } });
    if (existing && existing.status === 'SUCCEEDED') {
      return res.status(409).json({ error: 'A deposit has already been paid for this quote.' });
    }

    const depositCents = depositCentsFor(quote.quoteLow, quote.quoteHigh);
    const commissionCents = commissionCentsFor(depositCents);
    const amountCents = depositCents + commissionCents; // fee on top
    const description = `Deposit — ${quote.business.companyName}`;

    // Create/refresh the PENDING row first so its id can ride along as Checkout
    // metadata; the webhook uses it to settle this exact payment.
    const data = {
      clientId: req.user.id,
      businessId: quote.business.id,
      quoteRequestId,
      amountCents,
      commissionCents,
      status: 'PENDING',
      description,
    };
    const payment = existing
      ? await db.payment.update({ where: { id: existing.id }, data })
      : await db.payment.create({ data });

    const client = await db.user.findUnique({
      where: { id: req.user.id }, select: { email: true },
    });

    const session = await createDepositCheckoutSession({
      amountCents,
      commissionCents,
      connectedAccountId: quote.business.stripeAccountId,
      customerEmail: client?.email,
      description,
      metadata: {
        paymentId: payment.id,
        quoteRequestId,
        businessId: quote.business.id,
        clientId: req.user.id,
      },
    });

    res.status(201).json({
      paymentId: payment.id,
      url: session.url,
      amountCents,
      depositCents,
      commissionCents,
    });
  } catch (err) {
    next(err);
  }
});

// POST /payments/:id/refund — fully refund a settled deposit. Authorized for the
// contractor who received it (the owning BUSINESS user) and for any ADMIN.
// Stripe reverses the transfer and refunds our commission, making the homeowner
// whole; the charge.refunded webhook flips the row to REFUNDED + stamps
// refundedAt, so we don't optimistically mutate status here.
router.post('/:id/refund', authMiddleware, async (req, res, next) => {
  try {
    const payment = await db.payment.findUnique({
      where: { id: req.params.id },
      include: { business: { select: { userId: true } } },
    });
    if (!payment) return res.status(404).json({ error: 'Not found' });

    const isOwner = req.user.role === 'BUSINESS' && payment.business.userId === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    if (payment.status !== 'SUCCEEDED') {
      return res.status(409).json({ error: 'Only a settled deposit can be refunded.' });
    }
    if (!payment.stripePaymentIntentId) {
      return res.status(409).json({ error: 'This payment has no Stripe charge to refund.' });
    }

    await createRefund(payment.stripePaymentIntentId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /payments/earnings — the contractor's money at a glance. Two income
// streams settle differently:
//   • Quote deposits are destination charges — the contractor's net
//     (amount − commission) lands in their Stripe balance as soon as the
//     deposit SUCCEEDS, so a settled deposit counts as released.
//   • Milestone escrow holds the homeowner's funds on the platform; the
//     contractor receives the milestone amount (commission was charged on top
//     to the homeowner) only when the milestone is APPROVED/released. Until
//     then it sits in escrow.
router.get('/earnings', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile found' });

    const [payments, milestones] = await Promise.all([
      db.payment.findMany({
        where: { businessId: business.id },
        select: { amountCents: true, commissionCents: true, status: true, milestoneId: true },
      }),
      db.milestone.findMany({
        where: { project: { businessId: business.id } },
        select: { amountCents: true, status: true },
      }),
    ]);

    // Deposits (non-milestone payments): net to the contractor on settlement.
    const deposits = payments.filter((p) => !p.milestoneId);
    const settledDeposits = deposits.filter((p) => p.status === 'SUCCEEDED');
    const depositsNetCents = settledDeposits.reduce((s, p) => s + (p.amountCents - p.commissionCents), 0);

    // Milestones: released once APPROVED; held while FUNDED/SUBMITTED.
    const approved = milestones.filter((m) => m.status === 'APPROVED');
    const held = milestones.filter((m) => m.status === 'FUNDED' || m.status === 'SUBMITTED');
    const milestonesReleasedCents = approved.reduce((s, m) => s + m.amountCents, 0);
    const inEscrowCents = held.reduce((s, m) => s + m.amountCents, 0);

    // Platform fees taken across every settled payment (informational).
    const lifetimeFeesCents = payments
      .filter((p) => p.status === 'SUCCEEDED')
      .reduce((s, p) => s + p.commissionCents, 0);
    const refundedCents = payments
      .filter((p) => p.status === 'REFUNDED')
      .reduce((s, p) => s + p.amountCents, 0);

    res.json({
      releasedCents: depositsNetCents + milestonesReleasedCents,
      inEscrowCents,
      lifetimeFeesCents,
      refundedCents,
      releasedCount: settledDeposits.length + approved.length,
      inEscrowCount: held.length,
    });
  } catch (err) {
    next(err);
  }
});

// GET /payments — role-scoped payment history, newest first.
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const where = req.user.role === 'CLIENT'
      ? { clientId: req.user.id }
      : { business: { userId: req.user.id } };

    const payments = await db.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        business: { select: { id: true, companyName: true, logoUrl: true } },
        client: { select: { id: true, name: true } },
      },
    });
    res.json(payments);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
