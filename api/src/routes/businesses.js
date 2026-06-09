const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { notifyMatchingSearches } = require('../services/savedSearch');
const upload = require('../middleware/upload');
const { uploadImage } = require('../services/storage');

// Public shareable URL for a business profile. Contractors share this (link +
// QR) on their site/Instagram/cards to send customers straight to their profile;
// it's also where the future web landing page (apple-app-site-association
// universal link) will resolve. Derived from APP_BASE_URL so it's env-driven.
function shareUrlFor(id) {
  const base = (process.env.APP_BASE_URL || 'https://renovateconnect.app').replace(/\/+$/, '');
  return `${base}/b/${id}`;
}

const profileSchema = z.object({
  companyName: z.string().min(1).max(120),
  description: z.string().min(1).max(5000),
  city: z.string().min(1).max(100),
  state: z.string().length(2),
  zipCode: z.string().min(3).max(12),
  specialties: z.array(z.string().min(1).max(40)).min(1).max(20),
  yearsInBusiness: z.number().int().min(0).max(200).optional(),
  licenseNumber: z.string().max(60).optional(),
  website: z.string().url().max(2000).optional(),
  address: z.string().max(200).optional(),
  // Geocoded on the client (contractor's device) from their address so the API
  // stays free of a geocoding dependency. Powers "near me" distance search.
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
}).strict();

// Great-circle distance in miles between two lat/lng points (Haversine).
function milesBetween(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Public: search businesses
router.get('/', async (req, res, next) => {
  try {
    const { specialty, city, state, q, page = '1', limit = '20', lat, lng, radiusMiles } = req.query;
    const pageNum = parseInt(page);
    const take = parseInt(limit);
    const skip = (pageNum - 1) * take;

    // Public search shows only admin-approved listings. Pending/rejected
    // businesses are visible only to their owner (via /dashboard) and admins.
    const where = { approvalStatus: 'APPROVED' };
    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (state) where.state = state.toUpperCase();
    if (specialty) where.specialties = { has: specialty };
    if (q) where.companyName = { contains: q, mode: 'insensitive' };

    const include = {
      reviews: { take: 3, orderBy: { createdAt: 'desc' } },
      // One hero project (featured first, approved only) so list cards can
      // render real project imagery rather than a bare logo.
      portfolio: {
        where: { approvalStatus: 'APPROVED' },
        take: 1,
        orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
      },
    };

    // Sponsored slot (Pro subscribers): a small, clearly-labeled set surfaced
    // ABOVE organic results — it never reorders the organic list, so the
    // verification/rating ranking (and its trust signal) stays intact. Shown on
    // the first page only; rotated for fairness among eligible Pro businesses.
    const SPONSORED_CAP = 3;
    let sponsored = [];
    if (pageNum === 1) {
      const pool = await db.business.findMany({
        where: { ...where, proStatus: { in: ['trialing', 'active'] } },
        include,
        take: 12,
        orderBy: { averageRating: 'desc' },
      });
      // Shuffle so the same few don't always lead.
      for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      sponsored = pool.slice(0, SPONSORED_CAP).map((b) => ({ ...b, sponsored: true }));
    }

    // "Near me" mode — viewer coordinates provided. Rank by distance instead of
    // verified/rating. Done in JS (no PostGIS): fine at launch scale; we cap the
    // candidate set so it never fans out unbounded.
    const viewerLat = lat !== undefined ? parseFloat(lat) : null;
    const viewerLng = lng !== undefined ? parseFloat(lng) : null;
    const distanceMode = Number.isFinite(viewerLat) && Number.isFinite(viewerLng);

    if (distanceMode) {
      const radius = radiusMiles !== undefined ? parseFloat(radiusMiles) : null;
      const candidates = await db.business.findMany({
        where, include, take: 500, orderBy: [{ verified: 'desc' }, { averageRating: 'desc' }],
      });

      const withDistance = candidates.map((b) => ({
        ...b,
        distanceMiles: (b.lat != null && b.lng != null)
          ? Math.round(milesBetween(viewerLat, viewerLng, b.lat, b.lng) * 10) / 10
          : null,
      }));

      // Within radius (if given) drops coordless businesses; otherwise they sort
      // last so "near me" still shows everything when geocoding is incomplete.
      const filtered = radius != null
        ? withDistance.filter((b) => b.distanceMiles != null && b.distanceMiles <= radius)
        : withDistance;
      filtered.sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));

      const pageItems = filtered.slice(skip, skip + take);
      if (pageItems.length > 0) {
        db.business.updateMany({
          where: { id: { in: pageItems.map((b) => b.id) } },
          data: { searchImpressions: { increment: 1 } },
        }).catch(() => {});
      }
      return res.json({ businesses: pageItems, total: filtered.length, page: pageNum, limit: take, sponsored });
    }

    const [businesses, total] = await Promise.all([
      db.business.findMany({
        where,
        skip,
        take,
        // Admin-verified businesses surface first (our curated trust signal),
        // then by rating. (Paid promotion no longer affects ranking.)
        orderBy: [{ verified: 'desc' }, { averageRating: 'desc' }],
        include,
      }),
      db.business.count({ where }),
    ]);

    // Count one search impression for every listing actually shown on this page
    // (fire-and-forget so it never slows the response).
    if (businesses.length > 0) {
      db.business.updateMany({
        where: { id: { in: businesses.map((b) => b.id) } },
        data: { searchImpressions: { increment: 1 } },
      }).catch(() => {});
    }

    return res.json({ businesses, total, page: pageNum, limit: take, sponsored });
  } catch (err) {
    return next(err);
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
      searchImpressions: business.searchImpressions,
      profileViews: business.profileViews,
      averageRating: business.averageRating,
      reviewCount: business.reviewCount,
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

// Public: single business (also records a profile view).
// Approval gate: PENDING/REJECTED listings are visible only to their owner
// (so they can preview + see status) and to admins (for review).
router.get('/:id', async (req, res, next) => {
  try {
    // Optional auth parse — used both for the approval gate and to skip the
    // owner's own profile view.
    let viewerId = null;
    let viewerRole = null;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const payload = require('jsonwebtoken').verify(header.slice(7), process.env.JWT_SECRET);
        viewerId = payload.id;
        viewerRole = payload.role;
      } catch { /* ignore */ }
    }

    const business = await db.business.findUnique({
      where: { id: req.params.id },
      include: {
        reviews: { orderBy: { createdAt: 'desc' } },
        // Public viewers only see approved portfolio projects; the owner and
        // admins see everything (including their own pending/rejected items).
        portfolio: { orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }] },
        hours: { orderBy: { dayOfWeek: 'asc' } },
      },
    });
    if (!business) return res.status(404).json({ error: 'Not found' });

    const isOwner = viewerId === business.userId;
    const isAdmin = viewerRole === 'ADMIN';
    if (business.approvalStatus !== 'APPROVED' && !isOwner && !isAdmin) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!isOwner && !isAdmin) {
      business.portfolio = business.portfolio.filter((p) => p.approvalStatus === 'APPROVED');
    }

    // Count a view unless the owner is looking at their own profile (fire-and-forget).
    if (!isOwner) {
      db.business.update({ where: { id: business.id }, data: { profileViews: { increment: 1 } } }).catch(() => {});
    }

    res.json({ ...business, shareUrl: shareUrlFor(business.id) });
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
    // A user can only have one business profile (unique userId). A double-submit
    // would otherwise surface as an opaque 500 — return a clear 409 instead.
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'You already have a business profile.' });
    }
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
    const { verified } = z.object({ verified: z.boolean() }).strict().parse(req.body);
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

// ---------------------------------------------------------------------------
// Business hours (weekly recurring open hours)
// ---------------------------------------------------------------------------

const hoursDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openMinute: z.number().int().min(0).max(1439),
  closeMinute: z.number().int().min(1).max(1440),
  closed: z.boolean().optional(),
}).strict().refine((d) => d.closed === true || d.closeMinute > d.openMinute, {
  message: 'closeMinute must be after openMinute',
});

const hoursSchema = z.object({
  hours: z.array(hoursDaySchema).max(7),
}).strict();

// Public: a business's weekly hours, ordered Sunday→Saturday.
router.get('/:id/hours', async (req, res, next) => {
  try {
    const hours = await db.businessHours.findMany({
      where: { businessId: req.params.id },
      orderBy: { dayOfWeek: 'asc' },
    });
    res.json(hours);
  } catch (err) {
    next(err);
  }
});

// Owner: replace the full week of hours in one shot. Sending a day omits it
// (treated as unknown); send `closed: true` to mark a day off explicitly.
// Duplicate weekdays are rejected so the unique constraint never surprises us.
router.put('/:id/hours', authMiddleware, requireRole('BUSINESS', 'ADMIN'), async (req, res, next) => {
  try {
    const business = await requireBusinessOwner(req, res);
    if (!business) return;
    const { hours } = hoursSchema.parse(req.body);

    const days = hours.map((h) => h.dayOfWeek);
    if (new Set(days).size !== days.length) {
      return res.status(422).json({ error: 'Duplicate weekday in hours' });
    }

    const saved = await db.$transaction(async (tx) => {
      await tx.businessHours.deleteMany({ where: { businessId: business.id } });
      if (hours.length) {
        await tx.businessHours.createMany({
          data: hours.map((h) => ({
            businessId: business.id,
            dayOfWeek: h.dayOfWeek,
            openMinute: h.openMinute,
            closeMinute: h.closeMinute,
            closed: h.closed ?? false,
          })),
        });
      }
      return tx.businessHours.findMany({
        where: { businessId: business.id },
        orderBy: { dayOfWeek: 'asc' },
      });
    });

    res.json(saved);
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
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(60).optional(),
  costMin: z.number().int().min(0).max(100000000).optional(),
  costMax: z.number().int().min(0).max(100000000).optional(),
  durationWeeks: z.number().int().min(0).max(520).optional(),
  imageUrls: z.array(z.string().url().max(2000)).max(30).optional(),
  featured: z.boolean().optional(),
}).strict();

// Ensure the signed-in user owns the business in the route param.
async function requireBusinessOwner(req, res) {
  const business = await db.business.findUnique({ where: { id: req.params.id } });
  if (!business) { res.status(404).json({ error: 'Not found' }); return null; }
  if (business.userId !== req.user.id && req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' }); return null;
  }
  return business;
}

// Public: list a business's portfolio projects. Public viewers see only
// approved projects; the owner and admins see everything (so the owner can
// preview pending submissions in the portfolio manager).
router.get('/:id/portfolio', async (req, res, next) => {
  try {
    let viewerId = null;
    let viewerRole = null;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const payload = require('jsonwebtoken').verify(header.slice(7), process.env.JWT_SECRET);
        viewerId = payload.id;
        viewerRole = payload.role;
      } catch { /* ignore */ }
    }
    const business = await db.business.findUnique({ where: { id: req.params.id } });
    if (!business) return res.status(404).json({ error: 'Not found' });
    const isOwner = viewerId === business.userId;
    const isAdmin = viewerRole === 'ADMIN';

    const where = { businessId: req.params.id };
    if (!isOwner && !isAdmin) where.approvalStatus = 'APPROVED';

    const projects = await db.portfolioProject.findMany({
      where,
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

// Owner: upload one or more photos for a portfolio project. Files arrive as
// multipart form-data under the field name "images" (matches estimations.js).
// Each is pushed to S3 and the resulting URLs are appended to imageUrls so
// the existing array is preserved; clients can then PUT to reorder or remove.
router.post(
  '/:id/portfolio/:projectId/images',
  authMiddleware,
  requireRole('BUSINESS', 'ADMIN'),
  upload.array('images', 10),
  async (req, res, next) => {
    try {
      const business = await requireBusinessOwner(req, res);
      if (!business) return;
      const existing = await db.portfolioProject.findUnique({ where: { id: req.params.projectId } });
      if (!existing || existing.businessId !== business.id) {
        return res.status(404).json({ error: 'Not found' });
      }
      if (!req.files?.length) return res.status(400).json({ error: 'No images uploaded' });

      const base = `${req.protocol}://${req.get('host')}`;
      const urls = await Promise.all(req.files.map((f) => uploadImage(f.buffer, f.mimetype, base)));
      // type=before appends to the Before & After "before" set; default is the
      // "after"/result set (imageUrls), preserving existing behavior.
      const isBefore = req.body.type === 'before';
      const project = await db.portfolioProject.update({
        where: { id: existing.id },
        data: isBefore
          ? { beforeImageUrls: [...existing.beforeImageUrls, ...urls] }
          : { imageUrls: [...existing.imageUrls, ...urls] },
      });
      res.json(project);
    } catch (err) {
      next(err);
    }
  }
);

// Owner: remove a single image from a portfolio project by its URL. Sending
// the URL (rather than an index) keeps deletes idempotent and resilient to
// concurrent reorders. We don't delete the S3 object here — it'll fall out
// of the bucket lifecycle policy. Returns the updated project.
router.delete(
  '/:id/portfolio/:projectId/images',
  authMiddleware,
  requireRole('BUSINESS', 'ADMIN'),
  async (req, res, next) => {
    try {
      const business = await requireBusinessOwner(req, res);
      if (!business) return;
      const { url } = z.object({ url: z.string().min(1).max(2000) }).strict().parse(req.body);
      const existing = await db.portfolioProject.findUnique({ where: { id: req.params.projectId } });
      if (!existing || existing.businessId !== business.id) {
        return res.status(404).json({ error: 'Not found' });
      }
      // Remove the URL from whichever set it's in (after or before).
      const project = await db.portfolioProject.update({
        where: { id: existing.id },
        data: {
          imageUrls: existing.imageUrls.filter((u) => u !== url),
          beforeImageUrls: existing.beforeImageUrls.filter((u) => u !== url),
        },
      });
      res.json(project);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
