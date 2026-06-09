// Admin approval queue + decisions.
//
// Every endpoint in this router is ADMIN-only. The queue is the source of
// truth for the admin tab in the iOS app: it returns every business listing
// and every portfolio project that is awaiting (or has been previously
// rejected and is awaiting reconsideration) review. Decisions stamp a
// reviewedAt timestamp so admins can see what was acted on when.
//
// A REJECTED status carries an optional rejectionReason that surfaces in the
// owner's UI so they know what to fix.

const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware, requireRole('ADMIN'));

// GET /admin/pending — everything awaiting review, both kinds. Returned as
// two parallel arrays so the iOS view can render two sections without
// re-grouping on the client.
router.get('/pending', async (_req, res, next) => {
  try {
    const [businesses, projects] = await Promise.all([
      db.business.findMany({
        where: { approvalStatus: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      db.portfolioProject.findMany({
        where: { approvalStatus: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        include: {
          business: { select: { id: true, companyName: true } },
        },
      }),
    ]);
    res.json({ businesses, projects });
  } catch (err) {
    next(err);
  }
});

const decisionSchema = z.object({
  reason: z.string().max(500).optional(),
}).strict();

function decide(target) {
  // target is the model accessor, e.g. db.business or db.portfolioProject.
  return async (status, id, reason) => {
    const existing = await target.findUnique({ where: { id } });
    if (!existing) return null;
    return target.update({
      where: { id },
      data: {
        approvalStatus: status,
        rejectionReason: status === 'REJECTED' ? (reason ?? null) : null,
        reviewedAt: new Date(),
      },
    });
  };
}

router.post('/businesses/:id/approve', async (req, res, next) => {
  try {
    const updated = await decide(db.business)('APPROVED', req.params.id);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/businesses/:id/reject', async (req, res, next) => {
  try {
    const { reason } = decisionSchema.parse(req.body || {});
    const updated = await decide(db.business)('REJECTED', req.params.id, reason);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/portfolio/:projectId/approve', async (req, res, next) => {
  try {
    const updated = await decide(db.portfolioProject)('APPROVED', req.params.projectId);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/portfolio/:projectId/reject', async (req, res, next) => {
  try {
    const { reason } = decisionSchema.parse(req.body || {});
    const updated = await decide(db.portfolioProject)('REJECTED', req.params.projectId, reason);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
