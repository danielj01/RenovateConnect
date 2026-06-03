const router = require('express').Router();
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { digestSince, summarizeBusiness } = require('../services/favoritesDigest');

// All favorites endpoints are for homeowners curating their saved contractors.
router.use(authMiddleware, requireRole('CLIENT'));

// Load the signed-in homeowner's favorites with each business's portfolio and
// reviews, then fold them into per-business "what's new" digest entries. Shared
// by GET /favorites/digest and GET /favorites/digest/unseen.
async function buildDigest(userId) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { favoritesDigestSeenAt: true },
  });
  const favorites = await db.favorite.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      business: {
        include: {
          // Digest only surfaces admin-approved projects so homeowners aren't
          // notified about pending submissions.
          portfolio: { where: { approvalStatus: 'APPROVED' }, orderBy: { createdAt: 'desc' } },
          reviews: { orderBy: { createdAt: 'desc' } },
        },
      },
    },
  });

  return favorites.map((f) => {
    const { portfolio, reviews, ...business } = f.business;
    return summarizeBusiness({
      business,
      projects: portfolio,
      reviews,
      since: digestSince(f.createdAt, user?.favoritesDigestSeenAt),
    });
  });
}

// GET /favorites — the signed-in homeowner's saved contractors.
// Returns the businesses themselves (with the same shape as search results)
// so the iOS "My Projects" hub can render them with existing card views.
router.get('/', async (req, res, next) => {
  try {
    const favorites = await db.favorite.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        business: {
          include: { reviews: { take: 3, orderBy: { createdAt: 'desc' } } },
        },
      },
    });
    res.json(favorites.map((f) => f.business));
  } catch (err) {
    next(err);
  }
});

// GET /favorites/digest — "what's new with your saved contractors": only the
// businesses that have new portfolio projects or reviews since the homeowner
// last viewed, newest activity first.
router.get('/digest', async (req, res, next) => {
  try {
    const entries = (await buildDigest(req.user.id))
      .filter((e) => e.hasUpdates)
      .sort((a, b) => new Date(b.latestAt) - new Date(a.latestAt));
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

// GET /favorites/digest/unseen — counts for the badge: how many businesses have
// updates and the total number of new items across all of them.
router.get('/digest/unseen', async (req, res, next) => {
  try {
    const entries = (await buildDigest(req.user.id)).filter((e) => e.hasUpdates);
    const items = entries.reduce((sum, e) => sum + e.newProjectCount + e.newReviewCount, 0);
    res.json({ businesses: entries.length, items });
  } catch (err) {
    next(err);
  }
});

// POST /favorites/digest/seen — advance the watermark so everything currently
// in the digest is considered read.
router.post('/digest/seen', async (req, res, next) => {
  try {
    const seenAt = new Date();
    await db.user.update({
      where: { id: req.user.id },
      data: { favoritesDigestSeenAt: seenAt },
    });
    res.json({ seenAt: seenAt.toISOString() });
  } catch (err) {
    next(err);
  }
});

// POST /favorites/:businessId — save a contractor. Idempotent: saving an
// already-saved business is a no-op that still returns 201.
router.post('/:businessId', async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { id: req.params.businessId } });
    if (!business) return res.status(404).json({ error: 'Not found' });

    const favorite = await db.favorite.upsert({
      where: { userId_businessId: { userId: req.user.id, businessId: business.id } },
      create: { userId: req.user.id, businessId: business.id },
      update: {},
    });
    res.status(201).json({ id: favorite.id, businessId: favorite.businessId });
  } catch (err) {
    next(err);
  }
});

// DELETE /favorites/:businessId — unsave. Idempotent (204 even if not saved).
router.delete('/:businessId', async (req, res, next) => {
  try {
    await db.favorite.deleteMany({
      where: { userId: req.user.id, businessId: req.params.businessId },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
