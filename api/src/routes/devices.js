const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware } = require('../middleware/auth');

const registerSchema = z.object({
  token: z.string().min(1).max(500),
  platform: z.string().max(20).optional(),
}).strict();

// POST /devices — register (or re-claim) an APNs device token for the user.
// Idempotent: the same token re-registering just moves it to the current user
// (e.g. a shared device used by a different account) and refreshes the row.
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { token, platform } = registerSchema.parse(req.body);
    const device = await db.deviceToken.upsert({
      where: { token },
      create: { token, platform: platform || 'ios', userId: req.user.id },
      update: { userId: req.user.id, platform: platform || 'ios' },
    });
    res.status(201).json({ id: device.id, token: device.token, platform: device.platform });
  } catch (err) {
    next(err);
  }
});

// DELETE /devices/:token — unregister on logout. Scoped to the caller so a user
// can only remove their own token.
router.delete('/:token', authMiddleware, async (req, res, next) => {
  try {
    await db.deviceToken.deleteMany({
      where: { token: req.params.token, userId: req.user.id },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
