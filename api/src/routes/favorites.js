const router = require('express').Router();
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');

// All favorites endpoints are for homeowners curating their saved contractors.
router.use(authMiddleware, requireRole('CLIENT'));

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
