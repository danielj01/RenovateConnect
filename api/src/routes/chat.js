const router = require('express').Router();
const { z } = require('zod');
const { authMiddleware } = require('../middleware/auth');
const { chatWithAssistant } = require('../services/ai');
const { extractMentions } = require('../utils/mentions');
const db = require('../services/db');

// Cap message + history (length and turn count) — this is free text fed into
// the AI model, so bound cost/abuse.
const chatSchema = z.object({
  message: z.string().min(1).max(1000),
  history: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().max(4000),
    }).strict(),
  ).max(50).optional(),
}).strict();

router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { message, history } = chatSchema.parse(req.body);

    // Load all active businesses so the AI can recommend specific ones
    const businesses = await db.business.findMany({
      select: { id: true, companyName: true, city: true, state: true, specialties: true, averageRating: true },
    });

    const reply = await chatWithAssistant({ message, businessSummaries: businesses, history });
    // Surface any businesses the assistant named so the client can deep-link them.
    const mentioned = extractMentions(reply, businesses);
    res.json({ reply, mentioned });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
