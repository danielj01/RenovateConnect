const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { createLeadCharge } = require('../services/stripe');
const { sendPush } = require('../services/push');
const { recordActivity } = require('../services/activity');

// The timestamp a participant last opened a conversation. CLIENT and BUSINESS
// each track their own "last read" so unread counts are per-viewer.
function lastReadFor(conversation, user) {
  return user.role === 'CLIENT'
    ? conversation.clientLastReadAt
    : conversation.businessLastReadAt;
}

// Build the partial update that marks a conversation read for this viewer.
function readUpdateFor(user, when = new Date()) {
  return user.role === 'CLIENT'
    ? { clientLastReadAt: when }
    : { businessLastReadAt: when };
}

// True if `user` participates in `conversation`. Pass the conversation's
// business record (or its userId) to avoid a second lookup.
function isMember(conversation, businessUserId, user) {
  return conversation.clientId === user.id || businessUserId === user.id;
}

// GET /conversations — list conversations for the current user, each annotated
// with `unreadCount` (messages from the other party since the viewer last read).
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

    const withUnread = await Promise.all(conversations.map(async (conv) => {
      const lastRead = lastReadFor(conv, req.user);
      const unreadCount = await db.message.count({
        where: {
          conversationId: conv.id,
          senderId: { not: req.user.id },
          ...(lastRead ? { createdAt: { gt: lastRead } } : {}),
        },
      });
      return { ...conv, unreadCount };
    }));

    res.json(withUnread);
  } catch (err) {
    next(err);
  }
});

// GET /conversations/unread — total unread message count for the current user,
// across all conversations. Lightweight endpoint for the inbox tab badge.
router.get('/unread', authMiddleware, async (req, res, next) => {
  try {
    const where = req.user.role === 'CLIENT'
      ? { clientId: req.user.id }
      : { business: { userId: req.user.id } };

    const conversations = await db.conversation.findMany({
      where,
      select: { id: true, clientLastReadAt: true, businessLastReadAt: true },
    });

    const counts = await Promise.all(conversations.map((conv) => {
      const lastRead = lastReadFor(conv, req.user);
      return db.message.count({
        where: {
          conversationId: conv.id,
          senderId: { not: req.user.id },
          ...(lastRead ? { createdAt: { gt: lastRead } } : {}),
        },
      });
    }));

    res.json({ count: counts.reduce((a, b) => a + b, 0) });
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
    // Sending implies the sender has read everything up to now.
    await db.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date(), ...readUpdateFor(req.user) },
    });

    if (isFirstContact) {
      const business = await db.business.findUnique({ where: { id: businessId } });
      await db.lead.create({ data: { conversationId: conversation.id, businessId } });
      // Queue lead charge — fire and forget; failures should be caught by Stripe retry logic
      if (business?.stripeCustomerId) {
        createLeadCharge(business.stripeCustomerId, business.companyName).catch(console.error);
      }
      // Notify the business owner of a new lead — fire and forget.
      if (business?.userId) {
        const client = await db.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
        const body = `${client?.name || 'A homeowner'} is interested in your services.`;
        sendPush(business.userId, {
          title: 'New lead 🎉',
          body,
          data: { type: 'lead', conversationId: conversation.id },
        }).catch(console.error);
        await recordActivity(business.userId, {
          type: 'LEAD',
          title: 'New lead',
          body,
          data: { conversationId: conversation.id },
        });
      }
    }

    res.status(201).json(conversation);
  } catch (err) {
    next(err);
  }
});

// POST /conversations/:id/read — mark the conversation read for the current user.
router.post('/:id/read', authMiddleware, async (req, res, next) => {
  try {
    const conv = await db.conversation.findUnique({ where: { id: req.params.id } });
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const business = await db.business.findUnique({ where: { id: conv.businessId } });
    if (!isMember(conv, business?.userId, req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updated = await db.conversation.update({
      where: { id: req.params.id },
      data: readUpdateFor(req.user),
    });
    res.json({ clientLastReadAt: updated.clientLastReadAt, businessLastReadAt: updated.businessLastReadAt });
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
    if (!isMember(conv, business?.userId, req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

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
    if (!isMember(conv, business?.userId, req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const message = await db.message.create({
      data: { conversationId: req.params.id, senderId: req.user.id, body },
    });
    // Sending implies the sender has read everything up to now.
    await db.conversation.update({
      where: { id: req.params.id },
      data: { updatedAt: new Date(), ...readUpdateFor(req.user) },
    });

    // Notify the *other* participant — fire and forget so push never blocks send.
    const senderIsClient = req.user.id === conv.clientId;
    const recipientId = senderIsClient ? business?.userId : conv.clientId;
    if (recipientId) {
      let title;
      if (senderIsClient) {
        const client = await db.user.findUnique({ where: { id: conv.clientId }, select: { name: true } });
        title = client?.name || 'New message';
      } else {
        title = business?.companyName || 'New message';
      }
      sendPush(recipientId, {
        title,
        body,
        data: { type: 'message', conversationId: conv.id },
      }).catch(console.error);
      await recordActivity(recipientId, {
        type: 'MESSAGE',
        title: `New message from ${title}`,
        body,
        data: { conversationId: conv.id },
      });
    }

    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
