const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');

const profileSchema = z.object({
  companyName: z.string().min(1),
  description: z.string().min(1),
  city: z.string(),
  state: z.string().length(2),
  zipCode: z.string(),
  specialties: z.array(z.string()).min(1),
  yearsInBusiness: z.number().int().min(0).optional(),
  licenseNumber: z.string().optional(),
  website: z.string().url().optional(),
  address: z.string().optional(),
});

// Public: search businesses
router.get('/', async (req, res, next) => {
  try {
    const { specialty, city, state, q, page = '1', limit = '20' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (state) where.state = state.toUpperCase();
    if (specialty) where.specialties = { has: specialty };
    if (q) where.companyName = { contains: q, mode: 'insensitive' };

    const [businesses, total] = await Promise.all([
      db.business.findMany({
        where,
        skip,
        take: parseInt(limit),
        // Promoted businesses first, then by rating
        orderBy: [{ isPromoted: 'desc' }, { averageRating: 'desc' }],
        include: { reviews: { take: 3, orderBy: { createdAt: 'desc' } } },
      }),
      db.business.count({ where }),
    ]);

    res.json({ businesses, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
});

// Public: single business
router.get('/:id', async (req, res, next) => {
  try {
    const business = await db.business.findUnique({
      where: { id: req.params.id },
      include: { reviews: { orderBy: { createdAt: 'desc' } } },
    });
    if (!business) return res.status(404).json({ error: 'Not found' });
    res.json(business);
  } catch (err) {
    next(err);
  }
});

// Business owner: create profile
router.post('/', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const data = profileSchema.parse(req.body);
    const business = await db.business.create({ data: { ...data, userId: req.user.id } });
    res.status(201).json(business);
  } catch (err) {
    next(err);
  }
});

// Business owner: update profile
router.put('/:id', authMiddleware, requireRole('BUSINESS'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { id: req.params.id } });
    if (!business || business.userId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = profileSchema.partial().parse(req.body);
    const updated = await db.business.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Public: add review
router.post('/:id/reviews', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const { rating, body } = z.object({ rating: z.number().int().min(1).max(5), body: z.string().optional() }).parse(req.body);
    const user = await db.user.findUnique({ where: { id: req.user.id } });
    await db.review.create({ data: { businessId: req.params.id, rating, body, authorName: user.name } });

    // Recalculate average
    const agg = await db.review.aggregate({ where: { businessId: req.params.id }, _avg: { rating: true }, _count: true });
    await db.business.update({
      where: { id: req.params.id },
      data: { averageRating: agg._avg.rating ?? 0, reviewCount: agg._count },
    });

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
