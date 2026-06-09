const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { recordActivity } = require('../services/activity');
const { sendPush } = require('../services/push');

// Keep the business's denormalized rating/count in sync after any change.
async function recomputeAggregate(businessId) {
  const agg = await db.review.aggregate({
    where: { businessId },
    _avg: { rating: true },
    _count: true,
  });
  await db.business.update({
    where: { id: businessId },
    data: { averageRating: agg._avg.rating ?? 0, reviewCount: agg._count },
  });
}

// GET /reviews/mine — the caller's own reviews, optionally scoped to one
// business so the app can tell whether they've already reviewed it.
router.get('/mine', authMiddleware, async (req, res, next) => {
  try {
    const where = { authorId: req.user.id };
    if (req.query.businessId) where.businessId = String(req.query.businessId);
    const reviews = await db.review.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ reviews });
  } catch (err) {
    next(err);
  }
});

// POST /reviews — a homeowner reviews a contractor. One review per business
// per author; a review is "verified" when the author has a confirmed
// appointment with that business.
router.post('/', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const { businessId, rating, body } = z.object({
      businessId: z.string().min(1).max(64),
      rating: z.number().int().min(1).max(5),
      body: z.string().max(2000).optional(),
    }).strict().parse(req.body);

    const business = await db.business.findUnique({ where: { id: businessId } });
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const existing = await db.review.findUnique({
      where: { businessId_authorId: { businessId, authorId: req.user.id } },
    });
    if (existing) return res.status(409).json({ error: 'You have already reviewed this business' });

    // Verified reviews come from homeowners who actually booked and had the
    // appointment confirmed — a stronger trust signal than an anonymous review.
    const confirmed = await db.appointment.findFirst({
      where: { businessId, clientId: req.user.id, status: 'CONFIRMED' },
    });

    const user = await db.user.findUnique({ where: { id: req.user.id } });
    const review = await db.review.create({
      data: {
        businessId,
        authorId: req.user.id,
        authorName: user.name,
        rating,
        body,
        appointmentId: confirmed?.id ?? undefined,
        verified: !!confirmed,
      },
    });

    await recomputeAggregate(businessId);

    await recordActivity(business.userId, {
      type: 'REVIEW',
      title: `New ${rating}-star review`,
      body: body?.slice(0, 140) || `${user.name} left a ${rating}-star review.`,
      data: { businessId },
    });

    res.status(201).json(review);
  } catch (err) {
    next(err);
  }
});

// PATCH /reviews/:id — author edits their own review.
router.patch('/:id', authMiddleware, async (req, res, next) => {
  try {
    const { rating, body } = z.object({
      rating: z.number().int().min(1).max(5).optional(),
      body: z.string().max(2000).optional(),
    }).strict().parse(req.body);

    const review = await db.review.findUnique({ where: { id: req.params.id } });
    if (!review) return res.status(404).json({ error: 'Review not found' });
    if (review.authorId !== req.user.id) return res.status(403).json({ error: 'Not your review' });

    const updated = await db.review.update({
      where: { id: req.params.id },
      data: {
        rating: rating ?? review.rating,
        body: body !== undefined ? body : review.body,
      },
    });
    await recomputeAggregate(review.businessId);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PUT /reviews/:id/response — the reviewed business publicly replies (or edits
// its reply). Owner-only (or admin). Notifies the review's author.
router.put('/:id/response', authMiddleware, requireRole('BUSINESS', 'ADMIN'), async (req, res, next) => {
  try {
    const { response } = z.object({
      response: z.string().min(1).max(2000),
    }).strict().parse(req.body);

    const review = await db.review.findUnique({ where: { id: req.params.id } });
    if (!review) return res.status(404).json({ error: 'Review not found' });

    const business = await db.business.findUnique({ where: { id: review.businessId } });
    if (!business || (business.userId !== req.user.id && req.user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Not your business' });
    }

    const updated = await db.review.update({
      where: { id: req.params.id },
      data: { response, respondedAt: new Date() },
    });

    // Let the homeowner know the business replied (best-effort).
    if (review.authorId) {
      const title = `${business.companyName} responded to your review`;
      await recordActivity(review.authorId, {
        type: 'REVIEW',
        title,
        body: response.slice(0, 140),
        data: { businessId: business.id },
      });
      sendPush(review.authorId, {
        type: 'REVIEW',
        title,
        body: response.slice(0, 140),
        data: { type: 'review', businessId: business.id },
      }).catch(console.error);
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /reviews/:id/response — the business removes its reply. Owner-only.
router.delete('/:id/response', authMiddleware, requireRole('BUSINESS', 'ADMIN'), async (req, res, next) => {
  try {
    const review = await db.review.findUnique({ where: { id: req.params.id } });
    if (!review) return res.status(404).json({ error: 'Review not found' });

    const business = await db.business.findUnique({ where: { id: review.businessId } });
    if (!business || (business.userId !== req.user.id && req.user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Not your business' });
    }

    const updated = await db.review.update({
      where: { id: req.params.id },
      data: { response: null, respondedAt: null },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /reviews/:id — author removes their own review.
router.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    const review = await db.review.findUnique({ where: { id: req.params.id } });
    if (!review) return res.status(404).json({ error: 'Review not found' });
    if (review.authorId !== req.user.id) return res.status(403).json({ error: 'Not your review' });

    await db.review.delete({ where: { id: req.params.id } });
    await recomputeAggregate(review.businessId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
