const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');

// Saved searches belong to homeowners curating contractor alerts.
router.use(authMiddleware, requireRole('CLIENT'));

const createSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    specialty: z.string().min(1).max(60).optional(),
    city: z.string().min(1).max(100).optional(),
    state: z.string().length(2).optional(),
    q: z.string().min(1).max(120).optional(),
  })
  .strict()
  // An all-empty search would match every business — require a real filter.
  .refine((d) => d.specialty || d.city || d.state || d.q, {
    message: 'Provide at least one search criterion',
  });

// GET /saved-searches — the signed-in homeowner's saved searches (newest first).
router.get('/', async (req, res, next) => {
  try {
    const searches = await db.savedSearch.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(searches);
  } catch (err) {
    next(err);
  }
});

// POST /saved-searches — store a new search to get alerts on future matches.
router.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const search = await db.savedSearch.create({
      data: {
        userId: req.user.id,
        name: data.name,
        specialty: data.specialty,
        city: data.city,
        state: data.state ? data.state.toUpperCase() : undefined,
        q: data.q,
      },
    });
    res.status(201).json(search);
  } catch (err) {
    next(err);
  }
});

// DELETE /saved-searches/:id — stop alerts for a saved search. Idempotent
// (204 even if it doesn't exist), scoped to the owner so you can't delete
// someone else's search.
router.delete('/:id', async (req, res, next) => {
  try {
    await db.savedSearch.deleteMany({
      where: { id: req.params.id, userId: req.user.id },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
