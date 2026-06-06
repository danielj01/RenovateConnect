const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const db = require('../services/db');
const { authMiddleware } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { estimateRenovationCost } = require('../services/ai');
const { uploadImage } = require('../services/storage');

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

    const imageBase64Array = req.files.map((f) => f.buffer.toString('base64'));
    const result = await estimateRenovationCost({
      imageBase64Array,
      roomType: req.body.roomType,
      description: req.body.description,
    });

    res.status(200).json({ result });
  } catch (err) {
    next(err);
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

    const imageBase64Array = req.files.map((f) => f.buffer.toString('base64'));
    const result = await estimateRenovationCost({
      imageBase64Array,
      roomType: req.body.roomType,
      description: req.body.description,
    });

    const estimation = await db.estimation.create({
      data: {
        userId: req.user.id,
        imageUrls,
        roomType: req.body.roomType,
        description: req.body.description,
        result,
      },
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
