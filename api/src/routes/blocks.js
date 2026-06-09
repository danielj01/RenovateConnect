// Blocks — App Store guideline 1.2 (let users block other users).
//
//   POST   /blocks           (auth)  block a user by id (idempotent)
//   DELETE /blocks/:userId   (auth)  unblock
//   GET    /blocks           (auth)  the caller's current block list
//
// Enforcement (messaging refusal, hiding conversations) lives in the routes
// that read user-to-user content. See `services/moderation.js` for the helper
// that answers "are A and B mutually blocked?".

const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware } = require('../middleware/auth');

// POST /blocks — idempotent (re-blocking a user no-ops).
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { userId } = z.object({
      userId: z.string().min(1).max(64),
    }).strict().parse(req.body);

    if (userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot block yourself' });
    }
    const target = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const block = await db.block.upsert({
      where: { blockerId_blockedId: { blockerId: req.user.id, blockedId: userId } },
      create: { blockerId: req.user.id, blockedId: userId },
      update: {},
      include: { blocked: { select: { id: true, name: true, avatarUrl: true } } },
    });
    res.status(201).json(block);
  } catch (err) {
    next(err);
  }
});

// DELETE /blocks/:userId — 204 whether or not a row existed.
router.delete('/:userId', authMiddleware, async (req, res, next) => {
  try {
    await db.block.deleteMany({
      where: { blockerId: req.user.id, blockedId: req.params.userId },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// GET /blocks — the caller's current block list with the blocked users'
// names/avatars so the iOS settings screen can render them.
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const blocks = await db.block.findMany({
      where: { blockerId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: { blocked: { select: { id: true, name: true, avatarUrl: true } } },
    });
    res.json(blocks);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
