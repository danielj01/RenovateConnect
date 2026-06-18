// Pre-launch email capture.
//
//   POST /waitlist            (public)  join the launch list (idempotent on email)
//   GET  /waitlist/admin      (admin)   list entries, newest first
//   GET  /waitlist/admin.csv  (admin)   same, as a CSV download for outreach
//
// The public POST is rate-limited per IP (it's an unauthenticated write to the
// open web). Re-submitting the same email updates the row rather than erroring,
// so a homeowner hitting "notify me" twice never sees a failure.

const router = require('express').Router();
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');

const joinLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: Number(process.env.WAITLIST_JOIN_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many sign-ups from this device. Please try again later.' },
});

const joinSchema = z.object({
  email:   z.string().trim().toLowerCase().email().max(254),
  role:    z.enum(['HOMEOWNER', 'CONTRACTOR']).optional(),
  city:    z.string().trim().max(120).optional(),
  source:  z.string().trim().max(60).optional(),
  context: z.string().trim().max(280).optional(),
}).strict();

// POST /waitlist — join (or refresh) the launch list. Always 200/201, never
// leaks whether the email was already on the list (privacy + idempotency).
router.post('/', joinLimiter, async (req, res, next) => {
  try {
    const data = joinSchema.parse(req.body);
    const entry = await db.waitlistEntry.upsert({
      where:  { email: data.email },
      create: {
        email:   data.email,
        role:    data.role || 'HOMEOWNER',
        city:    data.city || null,
        source:  data.source || null,
        context: data.context || null,
      },
      // Only fill blanks on re-submit; don't wipe context we already captured
      // with an emptier later submission.
      update: {
        role:    data.role || undefined,
        city:    data.city || undefined,
        source:  data.source || undefined,
        context: data.context || undefined,
      },
    });
    res.status(201).json({ ok: true, id: entry.id });
  } catch (err) {
    next(err);
  }
});

// GET /waitlist/admin — admin view. Optional ?role=HOMEOWNER|CONTRACTOR filter.
router.get('/admin', authMiddleware, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { role } = z.object({
      role: z.enum(['HOMEOWNER', 'CONTRACTOR']).optional(),
    }).parse(req.query);

    const where = role ? { role } : {};
    const [entries, total, homeowners, contractors] = await Promise.all([
      db.waitlistEntry.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000 }),
      db.waitlistEntry.count(),
      db.waitlistEntry.count({ where: { role: 'HOMEOWNER' } }),
      db.waitlistEntry.count({ where: { role: 'CONTRACTOR' } }),
    ]);
    res.json({ entries, counts: { total, homeowners, contractors } });
  } catch (err) {
    next(err);
  }
});

// GET /waitlist/admin.csv — CSV export for dropping into the outreach tracker
// or an email tool. Admin only.
router.get('/admin.csv', authMiddleware, requireRole('ADMIN'), async (_req, res, next) => {
  try {
    const entries = await db.waitlistEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 50000 });
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = 'email,role,city,source,context,createdAt\n';
    const body = entries.map((e) =>
      [e.email, e.role, e.city, e.source, e.context, e.createdAt.toISOString()].map(esc).join(',')
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="waitlist.csv"');
    res.send(header + body + '\n');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
