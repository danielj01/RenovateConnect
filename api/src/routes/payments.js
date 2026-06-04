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
} = require('../services/stripe');

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

// --- Homeowner deposit -------------------------------------------------------

// POST /payments/deposit — start a hosted Checkout for a deposit on an accepted
// quote. Returns a Stripe-hosted URL the app opens in a Safari view; the
// checkout.session.completed webhook settles the Payment row. Idempotent per
// quote: a quote has at most one Payment row (unique). A settled (SUCCEEDED)
// deposit can't be re-created; a PENDING/FAILED one is refreshed in place so an
// abandoned checkout can be retried.
router.post('/deposit', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const { quoteRequestId } = z.object({ quoteRequestId: z.string() }).parse(req.body);

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
