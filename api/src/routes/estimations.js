const router = require('express').Router();
const db = require('../services/db');
const { authMiddleware } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { estimateRenovationCost } = require('../services/ai');
const { uploadImage } = require('../services/storage');

// POST /estimations/guest — same AI estimate as the authed route, but for
// signed-out homeowners trying the app. We run the model and return the result
// WITHOUT persisting anything (no user to attach it to, no image storage). This
// is the low-friction "snap a photo, see a price before signing up" entry point.
router.post('/guest', upload.array('images', 5), async (req, res, next) => {
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
