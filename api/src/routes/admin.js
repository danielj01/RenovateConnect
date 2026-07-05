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
  // Returns { existing, updated } so callers can detect the transition (e.g.
  // saved-search alerts only fire when a business crosses INTO 'APPROVED').
  return async (status, id, reason) => {
    const existing = await target.findUnique({ where: { id } });
    if (!existing) return null;
    const updated = await target.update({
      where: { id },
      data: {
        approvalStatus: status,
        rejectionReason: status === 'REJECTED' ? (reason ?? null) : null,
        reviewedAt: new Date(),
      },
    });
    return { existing, updated };
  };
}

const { notifyMatchingSearches } = require('../services/savedSearch');

router.post('/businesses/:id/approve', async (req, res, next) => {
  try {
    const result = await decide(db.business)('APPROVED', req.params.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    // Saved-search alerts fire only on the transition INTO 'APPROVED'. A
    // re-approval of an already-approved business does not re-spam.
    if (result.existing.approvalStatus !== 'APPROVED') {
      await notifyMatchingSearches(result.updated);
    }
    res.json(result.updated);
  } catch (err) {
    next(err);
  }
});

router.post('/businesses/:id/reject', async (req, res, next) => {
  try {
    const { reason } = decisionSchema.parse(req.body || {});
    const result = await decide(db.business)('REJECTED', req.params.id, reason);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result.updated);
  } catch (err) {
    next(err);
  }
});

router.post('/portfolio/:projectId/approve', async (req, res, next) => {
  try {
    const result = await decide(db.portfolioProject)('APPROVED', req.params.projectId);
    if (!result) return res.status(404).json({ error: 'Not found' });
    // Approving a project with a cost range can change the business's tier.
    await recomputeBusinessCostTier(result.updated.businessId);
    res.json(result.updated);
  } catch (err) {
    next(err);
  }
});

router.post('/portfolio/:projectId/reject', async (req, res, next) => {
  try {
    const { reason } = decisionSchema.parse(req.body || {});
    const result = await decide(db.portfolioProject)('REJECTED', req.params.projectId, reason);
    if (!result) return res.status(404).json({ error: 'Not found' });
    // Rejecting a previously-approved project can drop it out of the tier calc.
    await recomputeBusinessCostTier(result.updated.businessId);
    res.json(result.updated);
  } catch (err) {
    next(err);
  }
});

const { recomputeBusinessVerified } = require('../services/verification');
const { recomputeBusinessCostTier } = require('../services/costTier');

// ─── VERIFICATION DOCUMENTS ───────────────────────────────────────────────────
//
// Admin queue + approve/reject for contractor-uploaded license, insurance,
// and (optionally) identity documents. Each decision recomputes the parent
// business's `verified` flag (services/verification.js).

router.get('/verifications', async (req, res, next) => {
  try {
    const { status } = z.object({
      status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'ALL']).optional(),
    }).parse(req.query);

    const where = !status || status === 'PENDING'
      ? { status: 'PENDING' }
      : status === 'ALL'
        ? {}
        : { status };

    const docs = await db.verificationDocument.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: {
        business: { select: { id: true, companyName: true, city: true, state: true } },
      },
    });
    res.json(docs);
  } catch (err) {
    next(err);
  }
});

router.post('/verifications/:id/approve', async (req, res, next) => {
  try {
    const doc = await db.verificationDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (doc.status === 'APPROVED') {
      return res.status(409).json({ error: 'Already approved.' });
    }

    const updated = await db.verificationDocument.update({
      where: { id: doc.id },
      data: {
        status: 'APPROVED',
        rejectionReason: null,
        reviewedAt: new Date(),
        reviewedById: req.user.id,
      },
    });
    const nowVerified = await recomputeBusinessVerified(doc.businessId);
    res.json({ document: updated, businessVerified: nowVerified });
  } catch (err) {
    next(err);
  }
});

router.post('/verifications/:id/reject', async (req, res, next) => {
  try {
    const { reason } = z.object({
      reason: z.string().trim().min(1).max(500),
    }).strict().parse(req.body);

    const doc = await db.verificationDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const updated = await db.verificationDocument.update({
      where: { id: doc.id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
        reviewedAt: new Date(),
        reviewedById: req.user.id,
      },
    });
    // Rejecting an existing APPROVED doc could drop a business's verified flag.
    const nowVerified = await recomputeBusinessVerified(doc.businessId);
    res.json({ document: updated, businessVerified: nowVerified });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
