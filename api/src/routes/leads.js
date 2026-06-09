const router = require('express').Router();
const { z } = require('zod');
const { authMiddleware, requireRole } = require('../middleware/auth');
const db = require('../services/db');

const leadUpdateSchema = z.object({
  status: z.enum(['NEW', 'CONTACTED', 'CONVERTED', 'CLOSED']).optional(),
  notes: z.string().max(2000).optional(),
  estimatedValue: z.number().int().min(0).max(100000000).nullable().optional(),
}).strict();

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

// Business: update a lead's pipeline status / notes / estimated value
router.patch('/:id', authMiddleware, requireRole('BUSINESS', 'ADMIN'), async (req, res, next) => {
  try {
    const data = leadUpdateSchema.parse(req.body);
    const lead = await db.lead.findUnique({ where: { id: req.params.id }, include: { business: true } });
    if (!lead) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'ADMIN' && lead.business.userId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const updated = await db.lead.update({
      where: { id: req.params.id },
      data,
      include: { conversation: { include: { client: { select: { id: true, name: true, email: true, phone: true } } } } },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
