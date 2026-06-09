const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { sendPush } = require('../services/push');
const { recordActivity } = require('../services/activity');

// Shared include so both sides see who/what the quote concerns. `payoutsEnabled`
// lets the homeowner's UI know whether a deposit can be paid, and `payment`
// surfaces a deposit's status so the card can flip to "Deposit paid".
const quoteInclude = {
  business: { select: { id: true, companyName: true, logoUrl: true, city: true, payoutsEnabled: true } },
  client: { select: { id: true, name: true, avatarUrl: true } },
  payment: { select: { status: true } },
};

// Notify a recipient about a quote-request event. Quote requests are sales
// leads, so they ride the LEAD notification category.
function notify(recipientId, { title, body, quoteId }) {
  if (!recipientId) return;
  sendPush(recipientId, {
    type: 'LEAD',
    title,
    body,
    data: { type: 'quote', quoteId },
  }).catch(console.error);
  return recordActivity(recipientId, {
    type: 'LEAD',
    title,
    body,
    data: { quoteId },
  });
}

// POST /quotes — a homeowner sends a structured project brief to a contractor.
router.post('/', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const data = z.object({
      businessId: z.string().min(1).max(64),
      description: z.string().min(1).max(4000),
      category: z.string().max(120).optional(),
      budgetMin: z.number().int().min(0).max(100000000).optional(),
      budgetMax: z.number().int().min(0).max(100000000).optional(),
      timeline: z.string().max(120).optional(),
      imageUrls: z.array(z.string().url().max(2000)).max(12).optional(),
    }).strict().parse(req.body);

    const business = await db.business.findUnique({ where: { id: data.businessId } });
    if (!business) return res.status(404).json({ error: 'Not found' });

    const quote = await db.quoteRequest.create({
      data: {
        clientId: req.user.id,
        businessId: data.businessId,
        description: data.description,
        category: data.category,
        budgetMin: data.budgetMin,
        budgetMax: data.budgetMax,
        timeline: data.timeline,
        imageUrls: data.imageUrls ?? [],
      },
      include: quoteInclude,
    });

    const client = await db.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
    await notify(business.userId, {
      title: 'New quote request 📋',
      body: `${client?.name || 'A homeowner'} asked for an estimate${data.category ? ` on ${data.category}` : ''}.`,
      quoteId: quote.id,
    });

    res.status(201).json(quote);
  } catch (err) {
    next(err);
  }
});

// GET /quotes — role-scoped list, newest first.
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const where = req.user.role === 'CLIENT'
      ? { clientId: req.user.id }
      : { business: { userId: req.user.id } };

    const quotes = await db.quoteRequest.findMany({
      where,
      include: quoteInclude,
      orderBy: { createdAt: 'desc' },
    });
    res.json(quotes);
  } catch (err) {
    next(err);
  }
});

// Membership check shared by GET/PATCH on a single quote.
async function loadOwnedQuote(req, res) {
  const quote = await db.quoteRequest.findUnique({
    where: { id: req.params.id },
    include: { business: { select: { userId: true, companyName: true, payoutsEnabled: true } } },
  });
  if (!quote) { res.status(404).json({ error: 'Not found' }); return null; }
  const isClient = quote.clientId === req.user.id;
  const isOwner = quote.business.userId === req.user.id;
  if (!isClient && !isOwner && req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' }); return null;
  }
  return { quote, isClient, isOwner };
}

// GET /quotes/:id — single quote, visible to either party.
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const loaded = await loadOwnedQuote(req, res);
    if (!loaded) return;
    const quote = await db.quoteRequest.findUnique({
      where: { id: req.params.id },
      include: quoteInclude,
    });
    res.json(quote);
  } catch (err) {
    next(err);
  }
});

// PATCH /quotes/:id — drives the lifecycle. The contractor sends a quote
// (QUOTED) or passes (DECLINED); the homeowner accepts (ACCEPTED) or withdraws
// (WITHDRAWN). Allowed transitions are enforced per role and per current state.
router.patch('/:id', authMiddleware, async (req, res, next) => {
  try {
    const body = z.object({
      status: z.enum(['QUOTED', 'DECLINED', 'ACCEPTED', 'WITHDRAWN']),
      quoteLow: z.number().int().min(0).max(100000000).optional(),
      quoteHigh: z.number().int().min(0).max(100000000).optional(),
      responseNote: z.string().max(2000).optional(),
    }).strict().parse(req.body);

    const loaded = await loadOwnedQuote(req, res);
    if (!loaded) return;
    const { quote, isClient, isOwner } = loaded;

    // Quote is settled — no further transitions.
    if (['ACCEPTED', 'DECLINED', 'WITHDRAWN'].includes(quote.status)) {
      return res.status(409).json({ error: 'This quote request is already closed.' });
    }

    const updateData = { status: body.status };
    let recipientId;
    let title;
    let messageBody;

    if (body.status === 'QUOTED' || body.status === 'DECLINED') {
      // Contractor-only actions.
      if (!isOwner && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Only the contractor can respond.' });
      }
      if (body.status === 'QUOTED') {
        if (body.quoteLow == null || body.quoteHigh == null) {
          return res.status(422).json({ error: 'A quote needs a low and high price.' });
        }
        if (body.quoteHigh < body.quoteLow) {
          return res.status(422).json({ error: 'High price must be at least the low price.' });
        }
        updateData.quoteLow = body.quoteLow;
        updateData.quoteHigh = body.quoteHigh;
        updateData.respondedAt = new Date();
        if (body.responseNote) updateData.responseNote = body.responseNote;
        title = 'You got a quote 💰';
        messageBody = `${quote.business.companyName} sent an estimate of $${body.quoteLow.toLocaleString()}–$${body.quoteHigh.toLocaleString()}.`;
      } else {
        updateData.respondedAt = new Date();
        if (body.responseNote) updateData.responseNote = body.responseNote;
        title = 'Quote request declined';
        messageBody = `${quote.business.companyName} can't take this project right now.`;
      }
      recipientId = quote.clientId;
    } else {
      // Homeowner-only actions: ACCEPTED / WITHDRAWN.
      if (!isClient) {
        return res.status(403).json({ error: 'Only the homeowner can do that.' });
      }
      if (body.status === 'ACCEPTED' && quote.status !== 'QUOTED') {
        return res.status(409).json({ error: 'There is no quote to accept yet.' });
      }
      recipientId = quote.business.userId;
      const client = await db.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
      if (body.status === 'ACCEPTED') {
        title = 'Quote accepted 🎉';
        messageBody = `${client?.name || 'A homeowner'} accepted your quote.`;
      } else {
        title = 'Quote request withdrawn';
        messageBody = `${client?.name || 'A homeowner'} withdrew their quote request.`;
      }
    }

    const updated = await db.quoteRequest.update({
      where: { id: req.params.id },
      data: updateData,
      include: quoteInclude,
    });

    await notify(recipientId, { title, body: messageBody, quoteId: updated.id });

    // When a homeowner accepts and the contractor can take in-app payments,
    // nudge the homeowner to pay the deposit — this is the path that keeps the
    // transaction (and our commission) on-platform.
    if (body.status === 'ACCEPTED' && quote.business.payoutsEnabled) {
      await notify(quote.clientId, {
        title: 'Lock it in — pay your deposit 🔒',
        body: `Pay your deposit to ${quote.business.companyName} to confirm the job.`,
        quoteId: updated.id,
      });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
