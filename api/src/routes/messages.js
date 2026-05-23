const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { createLeadCharge } = require('../services/stripe');

// GET /conversations — list conversations for the current user
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const where = req.user.role === 'CLIENT'
      ? { clientId: req.user.id }
      : { business: { userId: req.user.id } };

    const conversations = await db.conversation.findMany({
      where,
      include: {
        business: { select: { id: true, companyName: true, logoUrl: true, city: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(conversations);
  } catch (err) {
    next(err);
  }
});

// POST /conversations — start a conversation (client → business); creates a Lead on first contact
router.post('/', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const { businessId, message } = z.object({
      businessId: z.string(),
      message: z.string().min(1),
    }).parse(req.body);

    const isFirstContact = !(await db.conversation.findUnique({
      where: { clientId_businessId: { clientId: req.user.id, businessId } },
    }));

    const conversation = await db.conversation.upsert({
      where: { clientId_businessId: { clientId: req.user.id, businessId } },
      create: { clientId: req.user.id, businessId },
      update: {},
    });

    await db.message.create({ data: { conversationId: conversation.id, senderId: req.user.id, body: message } });
    await db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

    if (isFirstContact) {
      const business = await db.business.findUnique({ where: { id: businessId } });
      await db.lead.create({ data: { conversationId: conversation.id, businessId } });
      // Queue lead charge — fire and forget; failures should be caught by Stripe retry logic
      if (business?.stripeCustomerId) {
        createLeadCharge(business.stripeCustomerId, business.companyName).catch(console.error);
      }
    }

    res.status(201).json(conversation);
  } catch (err) {
    next(err);
  }
});

// GET /conversations/:id/messages
router.get('/:id/messages', authMiddleware, async (req, res, next) => {
  try {
    const conv = await db.conversation.findUnique({ where: { id: req.params.id } });
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const business = await db.business.findUnique({ where: { id: conv.businessId } });
    const isMember = conv.clientId === req.user.id || business?.userId === req.user.id;
    if (!isMember) return res.status(403).json({ error: 'Forbidden' });

    const messages = await db.message.findMany({
      where: { conversationId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(messages);
  } catch (err) {
    next(err);
  }
});

// POST /conversations/:id/messages — send a message in an existing conversation
router.post('/:id/messages', authMiddleware, async (req, res, next) => {
  try {
    const { body } = z.object({ body: z.string().min(1) }).parse(req.body);
    const conv = await db.conversation.findUnique({ where: { id: req.params.id } });
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const business = await db.business.findUnique({ where: { id: conv.businessId } });
    const isMember = conv.clientId === req.user.id || business?.userId === req.user.id;
    if (!isMember) return res.status(403).json({ error: 'Forbidden' });

    const message = await db.message.create({
      data: { conversationId: req.params.id, senderId: req.user.id, body },
    });
    await db.conversation.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } });
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
