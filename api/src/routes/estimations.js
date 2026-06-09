const router = require('express').Router();
const crypto = require('crypto');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const db = require('../services/db');
const { authMiddleware } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { estimateRenovationCost } = require('../services/ai');
const { uploadImage } = require('../services/storage');

// Human-friendly share codes: no ambiguous chars (0/O, 1/I/L). Displayed as
// e.g. "ABCD-2345"; stored/looked up normalized (uppercase, no separators).
const SHARE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomShareCode(len = 8) {
  let out = '';
  for (let i = 0; i < len; i += 1) out += SHARE_ALPHABET[crypto.randomInt(SHARE_ALPHABET.length)];
  return out;
}
function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// The guest estimate is unauthenticated AND calls Claude (vision) — so it's both
// a cost center and a DoS target once exposed to the open web. Cap it tightly
// per IP, well below the global limiter. Skipped under test so suites can hit it
// freely. Relies on `trust proxy` (set in app.js) for the real client IP in prod.
const guestEstimateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: Number(process.env.GUEST_ESTIMATE_MAX || 8),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many estimates from this device. Please try again in a bit, or get the app.' },
});

// POST /estimations/guest — same AI estimate as the authed route, but for
// signed-out homeowners trying the app. We run the model and return the result
// WITHOUT persisting anything (no user to attach it to, no image storage). This
// is the low-friction "snap a photo, see a price before signing up" entry point.
router.post('/guest', guestEstimateLimiter, upload.array('images', 5), async (req, res, next) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ error: 'At least one image is required' });
    }

    const { roomType, description } = estimateInputSchema.parse(req.body);
    const imageBase64Array = req.files.map((f) => f.buffer.toString('base64'));
    const result = await estimateRenovationCost({ imageBase64Array, roomType, description });

    res.status(200).json({ result });
  } catch (err) {
    next(err);
  }
});

// Saved-estimate handoff: persist a guest's result so it can follow them into
// the app via a short code / universal link. Unauthenticated + display-only, so
// rate-limit it like the guest estimator.
const shareLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.SHARE_ESTIMATE_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

// Bound the free-text that gets sent into the AI model (cost + abuse control).
// Multipart may carry only these text fields; images are handled via req.files.
const estimateInputSchema = z.object({
  roomType: z.string().max(60).optional(),
  description: z.string().max(2000).optional(),
});

const shareSchema = z.object({
  // Stored as-is for redisplay; we don't trust it as anything but view data.
  result: z.record(z.any()),
  roomType: z.string().max(60).optional(),
});

// POST /estimations/share — store a result, return a short code.
router.post('/share', shareLimiter, async (req, res, next) => {
  try {
    const { result, roomType } = shareSchema.parse(req.body);
    // Retry on the (vanishingly unlikely) code collision.
    let code;
    for (let i = 0; i < 5; i += 1) {
      code = randomShareCode();
      const clash = await db.sharedEstimate.findUnique({ where: { code } });
      if (!clash) break;
    }
    const saved = await db.sharedEstimate.create({
      data: { code, roomType: roomType || null, result },
    });
    res.status(201).json({ code: saved.code });
  } catch (err) {
    next(err);
  }
});

// GET /estimations/shared/:code — read a saved estimate (web page + app hydrate).
router.get('/shared/:code', async (req, res, next) => {
  try {
    const code = normalizeCode(req.params.code);
    if (!code) return res.status(404).json({ error: 'Not found' });
    const est = await db.sharedEstimate.findUnique({ where: { code } });
    if (!est) return res.status(404).json({ error: 'Not found' });
    return res.json({
      code: est.code,
      roomType: est.roomType,
      result: est.result,
      createdAt: est.createdAt,
    });
  } catch (err) {
    return next(err);
  }
});

// POST /estimations — upload 1-5 photos, get back a cost estimate
router.post('/', authMiddleware, upload.array('images', 5), async (req, res, next) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ error: 'At least one image is required' });
    }

    const imageUrls = await Promise.all(
      req.files.map((f) => uploadImage(f.buffer, f.mimetype))
    );

    const { roomType, description } = estimateInputSchema.parse(req.body);
    const imageBase64Array = req.files.map((f) => f.buffer.toString('base64'));
    const result = await estimateRenovationCost({ imageBase64Array, roomType, description });

    const estimation = await db.estimation.create({
      data: { userId: req.user.id, imageUrls, roomType, description, result },
    });

    res.status(201).json(estimation);
  } catch (err) {
    next(err);
  }
});

// GET /estimations — list the authenticated user's past estimations
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const estimations = await db.estimation.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(estimations);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const est = await db.estimation.findUnique({ where: { id: req.params.id } });
    if (!est || est.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
    res.json(est);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
