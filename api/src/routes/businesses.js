const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { notifyMatchingSearches } = require('../services/savedSearch');

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

// Business owner: dashboard analytics for the signed-in business.
// NOTE: declared before '/:id' so "dashboard" isn't treated as an id.
router.get('/dashboard', authMiddleware, requireRole('BUSINESS', 'ADMIN'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'No business profile' });

    const [leads, conversationCount] = await Promise.all([
      db.lead.findMany({ where: { businessId: business.id }, select: { status: true, estimatedValue: true } }),
      db.conversation.count({ where: { businessId: business.id } }),
    ]);

    const byStatus = { NEW: 0, CONTACTED: 0, CONVERTED: 0, CLOSED: 0 };
    let pipelineValue = 0;
    let wonValue = 0;
    for (const l of leads) {
      byStatus[l.status] = (byStatus[l.status] || 0) + 1;
      if (l.status === 'CONVERTED') wonValue += l.estimatedValue || 0;
      else if (l.status !== 'CLOSED') pipelineValue += l.estimatedValue || 0;
    }
    const totalLeads = leads.length;
    const conversionRate = totalLeads ? Math.round((byStatus.CONVERTED / totalLeads) * 100) : 0;

    res.json({
      profileViews: business.profileViews,
      averageRating: business.averageRating,
      reviewCount: business.reviewCount,
      isPromoted: business.isPromoted,
      totalLeads,
      conversationCount,
      leadsByStatus: byStatus,
      conversionRate,
      pipelineValue,
      wonValue,
    });
  } catch (err) {
    next(err);
  }
});

// Public: single business (also records a profile view)
router.get('/:id', async (req, res, next) => {
  try {
    const business = await db.business.findUnique({
      where: { id: req.params.id },
      include: {
        reviews: { orderBy: { createdAt: 'desc' } },
        portfolio: { orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }] },
      },
    });
    if (!business) return res.status(404).json({ error: 'Not found' });

    // Count a view unless the owner is looking at their own profile (fire-and-forget).
    let viewerId = null;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try { viewerId = require('jsonwebtoken').verify(header.slice(7), process.env.JWT_SECRET).id; } catch { /* ignore */ }
    }
    if (viewerId !== business.userId) {
      db.business.update({ where: { id: business.id }, data: { profileViews: { increment: 1 } } }).catch(() => {});
    }

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
    // Alert homeowners whose saved searches match this new contractor. Awaited so
    // it's deterministic under test; the service swallows its own errors.
    await notifyMatchingSearches(business);
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

// Admin: toggle a business's verified trust badge. Stamps verifiedAt so the
// client can render a dynamic "Verified · checked {date}" badge.
router.patch('/:id/verify', authMiddleware, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { verified } = z.object({ verified: z.boolean() }).parse(req.body);
    const existing = await db.business.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const updated = await db.business.update({
      where: { id: req.params.id },
      data: { verified, verifiedAt: verified ? new Date() : null },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Reviews are handled by routes/reviews.js (POST/PATCH/DELETE /reviews);
// the business detail response above already includes them for display.

// ---------------------------------------------------------------------------
// Portfolio (project gallery)
// ---------------------------------------------------------------------------

const portfolioSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  costMin: z.number().int().min(0).optional(),
  costMax: z.number().int().min(0).optional(),
  durationWeeks: z.number().int().min(0).optional(),
  imageUrls: z.array(z.string()).optional(),
  featured: z.boolean().optional(),
});

// Ensure the signed-in user owns the business in the route param.
async function requireBusinessOwner(req, res) {
  const business = await db.business.findUnique({ where: { id: req.params.id } });
  if (!business) { res.status(404).json({ error: 'Not found' }); return null; }
  if (business.userId !== req.user.id && req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' }); return null;
  }
  return business;
}

// Public: list a business's portfolio projects
router.get('/:id/portfolio', async (req, res, next) => {
  try {
    const projects = await db.portfolioProject.findMany({
      where: { businessId: req.params.id },
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

// Owner: add a portfolio project
router.post('/:id/portfolio', authMiddleware, requireRole('BUSINESS', 'ADMIN'), async (req, res, next) => {
  try {
    const business = await requireBusinessOwner(req, res);
    if (!business) return;
    const data = portfolioSchema.parse(req.body);
    const project = await db.portfolioProject.create({ data: { ...data, businessId: business.id } });
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

// Owner: update a portfolio project
router.put('/:id/portfolio/:projectId', authMiddleware, requireRole('BUSINESS', 'ADMIN'), async (req, res, next) => {
  try {
    const business = await requireBusinessOwner(req, res);
    if (!business) return;
    const existing = await db.portfolioProject.findUnique({ where: { id: req.params.projectId } });
    if (!existing || existing.businessId !== business.id) return res.status(404).json({ error: 'Not found' });
    const data = portfolioSchema.partial().parse(req.body);
    const project = await db.portfolioProject.update({ where: { id: req.params.projectId }, data });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

// Owner: delete a portfolio project
router.delete('/:id/portfolio/:projectId', authMiddleware, requireRole('BUSINESS', 'ADMIN'), async (req, res, next) => {
  try {
    const business = await requireBusinessOwner(req, res);
    if (!business) return;
    const existing = await db.portfolioProject.findUnique({ where: { id: req.params.projectId } });
    if (!existing || existing.businessId !== business.id) return res.status(404).json({ error: 'Not found' });
    await db.portfolioProject.delete({ where: { id: req.params.projectId } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
