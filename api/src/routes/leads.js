const router = require('express').Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const db = require('../services/db');

// Business: view your leads
router.get('/', authMiddleware, requireRole('BUSINESS', 'ADMIN'), async (req, res, next) => {
  try {
    const business = await db.business.findUnique({ where: { userId: req.user.id } });
    if (!business && req.user.role !== 'ADMIN') return res.status(404).json({ error: 'No business profile' });

    const where = req.user.role === 'ADMIN' ? {} : { businessId: business.id };
    const leads = await db.lead.findMany({
      where,
      include: { conversation: { include: { client: { select: { id: true, name: true, email: true, phone: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(leads);
  } catch (err) {
    next(err);
  }
});

// Admin: mark lead as billed
router.patch('/:id/bill', authMiddleware, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const lead = await db.lead.update({
      where: { id: req.params.id },
      data: { billed: true, billedAt: new Date() },
    });
    res.json(lead);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
