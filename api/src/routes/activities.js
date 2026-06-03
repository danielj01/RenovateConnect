const router = require('express').Router();
const db = require('../services/db');
const { authMiddleware } = require('../middleware/auth');
const { deepLinkFor } = require('../services/deepLink');

// GET /activities — the current user's in-app feed, newest first. Each entry
// carries a normalized `link` ({ screen, id }) so the client can route on tap
// without inspecting the raw id keys inside `data`.
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const activities = await db.activity.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(activities.map((a) => ({ ...a, link: deepLinkFor(a.type, a.data) })));
  } catch (err) {
    next(err);
  }
});

// GET /activities/unread — count of unread feed entries (for the bell badge).
router.get('/unread', authMiddleware, async (req, res, next) => {
  try {
    const count = await db.activity.count({
      where: { userId: req.user.id, readAt: null },
    });
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

// POST /activities/read — mark all of the user's unread entries as read.
router.post('/read', authMiddleware, async (req, res, next) => {
  try {
    const result = await db.activity.updateMany({
      where: { userId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ updated: result.count });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
