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

// ─── DISPUTES ─────────────────────────────────────────────────────────────────
//
// Admin queue + resolution for milestone disputes. RELEASE flips the milestone
// to APPROVED and runs the standard release (transfers funds + notifies);
// REFUND triggers the milestone refund (the webhook flips it to REFUNDED).

const projectsModule = require('./projects');
const { createMilestoneRefund } = require('../services/stripe');
const { recomputeBusinessVerified } = require('../services/verification');

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

// GET /admin/disputes — open disputes by default; ?status=ALL or a specific
// DisputeStatus to widen. Includes the milestone, project, and the two parties
// so the admin screen can render full context in one fetch.
router.get('/disputes', async (req, res, next) => {
  try {
    const { status } = z.object({
      status: z.enum(['OPEN', 'RESOLVED_RELEASE', 'RESOLVED_REFUND', 'WITHDRAWN', 'ALL']).optional(),
    }).parse(req.query);

    const where = !status || status === 'OPEN'
      ? { status: 'OPEN' }
      : status === 'ALL'
        ? {}
        : { status };

    const disputes = await db.dispute.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        milestone: {
          include: {
            project: {
              include: {
                business: { select: { id: true, userId: true, companyName: true, stripeAccountId: true } },
                client:   { select: { id: true, name: true, email: true } },
              },
            },
          },
        },
      },
    });
    res.json(disputes);
  } catch (err) {
    next(err);
  }
});

// POST /admin/disputes/:id/resolve — admin picks RELEASE or REFUND.
// RELEASE → run releaseMilestone (transfer + notify + flip to APPROVED).
// REFUND  → kick off the Stripe refund; webhook flips the milestone to REFUNDED.
router.post('/disputes/:id/resolve', async (req, res, next) => {
  try {
    const { action, note } = z.object({
      action: z.enum(['RELEASE', 'REFUND']),
      note:   z.string().trim().max(2000).optional(),
    }).strict().parse(req.body);

    const dispute = await db.dispute.findUnique({
      where: { id: req.params.id },
      include: {
        milestone: {
          include: {
            project: {
              include: {
                business: { select: { id: true, userId: true, companyName: true, stripeAccountId: true } },
              },
            },
          },
        },
      },
    });
    if (!dispute) return res.status(404).json({ error: 'Not found' });
    if (dispute.status !== 'OPEN') {
      return res.status(409).json({ error: 'This dispute is already resolved.' });
    }

    const { milestone } = dispute;
    const { project } = milestone;

    if (action === 'RELEASE') {
      if (!project.business.stripeAccountId) {
        return res.status(409).json({ error: 'The contractor has no payout account.' });
      }
      await projectsModule.releaseMilestone(project, milestone);
      await db.dispute.update({
        where: { id: dispute.id },
        data: {
          status: 'RESOLVED_RELEASE',
          resolvedById: req.user.id,
          resolvedAt: new Date(),
          resolutionNote: note || null,
        },
      });
      await projectsModule.notifyPayment(project.clientId, {
        title: 'Dispute resolved — funds released',
        body: `An admin reviewed your dispute on "${milestone.title}" and released the payment to the contractor.${note ? ` Note: ${note}` : ''}`,
        data: { projectId: project.id, milestoneId: milestone.id, disputeId: dispute.id },
      });
    } else {
      const payment = await db.payment.findUnique({ where: { milestoneId: milestone.id } });
      if (!payment?.stripePaymentIntentId) {
        return res.status(409).json({ error: 'This milestone has no charge to refund.' });
      }
      await createMilestoneRefund(payment.stripePaymentIntentId);
      await db.dispute.update({
        where: { id: dispute.id },
        data: {
          status: 'RESOLVED_REFUND',
          resolvedById: req.user.id,
          resolvedAt: new Date(),
          resolutionNote: note || null,
        },
      });
      await projectsModule.notifyPayment(project.clientId, {
        title: 'Dispute resolved — refund issued',
        body: `An admin reviewed your dispute on "${milestone.title}" and refunded the held funds.${note ? ` Note: ${note}` : ''}`,
        data: { projectId: project.id, milestoneId: milestone.id, disputeId: dispute.id },
      });
      await projectsModule.notifyPayment(project.business.userId, {
        title: 'Dispute resolved — refunded',
        body: `An admin refunded the held funds on "${milestone.title}".${note ? ` Note: ${note}` : ''}`,
        data: { projectId: project.id, milestoneId: milestone.id, disputeId: dispute.id },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
