// Reports — App Store guideline 1.2 (UGC moderation).
//
//   POST   /reports          (auth)  file a report on a user/message/review/etc.
//   GET    /reports          (admin) review queue
//   PATCH  /reports/:id      (admin) resolve / dismiss
//
// Blocks live in routes/blocks.js.

const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');

const REPORT_TARGETS = ['USER', 'MESSAGE', 'REVIEW', 'PORTFOLIO', 'FEED', 'BUSINESS'];
const REPORT_REASONS = [
  'SPAM', 'HARASSMENT', 'HATE', 'SEXUAL', 'VIOLENCE',
  'SCAM', 'IMPERSONATION', 'OFF_PLATFORM', 'OTHER',
];

// ─── REPORTS ────────────────────────────────────────────────────────────────

// POST /reports — file a report. Anyone authenticated can report any target.
// We intentionally don't 404 on a missing target id: admins can still see the
// report and act, even if the target was deleted in the interim.
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { targetType, targetId, reason, details } = z.object({
      targetType: z.enum(REPORT_TARGETS),
      targetId: z.string().min(1).max(64),
      reason: z.enum(REPORT_REASONS),
      details: z.string().trim().max(2000).optional(),
    }).strict().parse(req.body);

    const report = await db.report.create({
      data: {
        reporterId: req.user.id,
        targetType,
        targetId,
        reason,
        details: details || null,
      },
    });
    res.status(201).json(report);
  } catch (err) {
    next(err);
  }
});

// GET /reports — admin queue. Defaults to PENDING; pass ?status=ALL or a
// specific status to widen.
router.get('/', authMiddleware, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { status } = z.object({
      status: z.enum(['PENDING', 'RESOLVED', 'DISMISSED', 'ALL']).optional(),
    }).parse(req.query);

    const where = !status || status === 'PENDING'
      ? { status: 'PENDING' }
      : status === 'ALL'
        ? {}
        : { status };

    const reports = await db.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        reporter:   { select: { id: true, name: true, email: true } },
        resolvedBy: { select: { id: true, name: true } },
      },
    });
    res.json(reports);
  } catch (err) {
    next(err);
  }
});

// PATCH /reports/:id — admin marks a report resolved or dismissed and (optionally)
// records the action taken in `resolution`.
router.patch('/:id', authMiddleware, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { status, resolution } = z.object({
      status: z.enum(['RESOLVED', 'DISMISSED']),
      resolution: z.string().trim().max(1000).optional(),
    }).strict().parse(req.body);

    const report = await db.report.findUnique({ where: { id: req.params.id } });
    if (!report) return res.status(404).json({ error: 'Not found' });

    const updated = await db.report.update({
      where: { id: req.params.id },
      data: {
        status,
        resolution: resolution || null,
        resolvedById: req.user.id,
        resolvedAt: new Date(),
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
