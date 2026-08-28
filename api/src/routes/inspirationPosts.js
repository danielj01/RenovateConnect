// Native Inspiration posts — a contractor publishing STRAIGHT to the
// Inspiration feed, instead of the feed only mirroring their portfolio.
//
//   GET    /businesses/:id/inspiration              public (approved only) /
//                                                   owner+admin (everything)
//   POST   /businesses/:id/inspiration              (owner) create — PENDING
//   PUT    /businesses/:id/inspiration/:postId      (owner) edit
//   DELETE /businesses/:id/inspiration/:postId      (owner) delete
//   POST   /businesses/:id/inspiration/:postId/images   (owner) add slides
//   DELETE /businesses/:id/inspiration/:postId/images   (owner) remove a slide
//
// The public read surface is routes/feed.js. Admin moderation lives in
// routes/admin.js. Editing an APPROVED post's content sends it back to PENDING
// (see `resubmitOnEdit`) — otherwise approval would be a one-time gate a
// contractor could walk straight through by swapping the photos afterwards.

const router = require('express').Router({ mergeParams: true });
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { uploadImage } = require('../services/storage');

const MAX_SLIDES = 20;

const postSchema = z.object({
  title:    z.string().min(1).max(120),
  caption:  z.string().max(2000).optional(),
  category: z.string().max(60).optional(),
  costMin:  z.number().int().min(0).max(100000000).optional(),
  costMax:  z.number().int().min(0).max(100000000).optional(),
  imageUrls:       z.array(z.string().url().max(2000)).max(MAX_SLIDES).optional(),
  beforeImageUrls: z.array(z.string().url().max(2000)).max(MAX_SLIDES).optional(),
}).strict();

// Ownership check — mirrors requireBusinessOwner in businesses.js so this
// router can stand alone with mergeParams (:id comes from the parent path).
async function requireBusinessOwner(req, res) {
  const business = await db.business.findUnique({ where: { id: req.params.id } });
  if (!business) { res.status(404).json({ error: 'Not found' }); return null; }
  if (business.userId !== req.user.id && req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' }); return null;
  }
  return business;
}

// Load a post and confirm it belongs to this business. Returns null (and sends
// a 404) otherwise, so a post id from another business can't be edited by
// guessing it.
async function loadOwnedPost(businessId, postId, res) {
  const post = await db.inspirationPost.findUnique({ where: { id: postId } });
  if (!post || post.businessId !== businessId) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  return post;
}

// Content edits re-open moderation. Admins editing on a contractor's behalf
// don't trip it — they're the reviewers.
function resubmitOnEdit(req) {
  return req.user.role === 'ADMIN'
    ? {}
    : { approvalStatus: 'PENDING', rejectionReason: null, reviewedAt: null };
}

// Public list. Public viewers see only approved posts; the owner and admins see
// everything so the composer can show pending/rejected items with their status.
router.get('/', async (req, res, next) => {
  try {
    let viewerId = null;
    let viewerRole = null;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const payload = require('jsonwebtoken').verify(header.slice(7), process.env.JWT_SECRET);
        viewerId = payload.id;
        viewerRole = payload.role;
      } catch { /* ignore — treat as an anonymous viewer */ }
    }
    const business = await db.business.findUnique({ where: { id: req.params.id } });
    if (!business) return res.status(404).json({ error: 'Not found' });
    const isOwner = viewerId === business.userId;
    const isAdmin = viewerRole === 'ADMIN';

    const where = { businessId: req.params.id };
    if (!isOwner && !isAdmin) where.approvalStatus = 'APPROVED';

    const posts = await db.inspirationPost.findMany({
      where,
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(posts);
  } catch (err) {
    next(err);
  }
});

router.post('/', authMiddleware, requireRole('BUSINESS', 'ADMIN'), async (req, res, next) => {
  try {
    const business = await requireBusinessOwner(req, res);
    if (!business) return;
    const data = postSchema.parse(req.body);
    const post = await db.inspirationPost.create({
      data: { ...data, businessId: business.id },
    });
    res.status(201).json(post);
  } catch (err) {
    next(err);
  }
});

router.put('/:postId', authMiddleware, requireRole('BUSINESS', 'ADMIN'), async (req, res, next) => {
  try {
    const business = await requireBusinessOwner(req, res);
    if (!business) return;
    const existing = await loadOwnedPost(business.id, req.params.postId, res);
    if (!existing) return;
    const data = postSchema.partial().parse(req.body);
    const post = await db.inspirationPost.update({
      where: { id: existing.id },
      data: { ...data, ...resubmitOnEdit(req) },
    });
    res.json(post);
  } catch (err) {
    next(err);
  }
});

router.delete('/:postId', authMiddleware, requireRole('BUSINESS', 'ADMIN'), async (req, res, next) => {
  try {
    const business = await requireBusinessOwner(req, res);
    if (!business) return;
    const existing = await loadOwnedPost(business.id, req.params.postId, res);
    if (!existing) return;
    await db.inspirationPost.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Add slides. Files arrive as multipart form-data under the field name
// "images" (matches the portfolio uploader). `type=before` appends to the
// paired "before" set instead of the slide set.
router.post(
  '/:postId/images',
  authMiddleware,
  requireRole('BUSINESS', 'ADMIN'),
  upload.array('images', 10),
  async (req, res, next) => {
    try {
      const business = await requireBusinessOwner(req, res);
      if (!business) return;
      const existing = await loadOwnedPost(business.id, req.params.postId, res);
      if (!existing) return;
      if (!req.files?.length) return res.status(400).json({ error: 'No images uploaded' });

      const isBefore = req.body.type === 'before';
      const current = isBefore ? existing.beforeImageUrls : existing.imageUrls;
      if (current.length + req.files.length > MAX_SLIDES) {
        return res.status(400).json({ error: `A post can hold at most ${MAX_SLIDES} photos` });
      }

      const urls = await Promise.all(req.files.map((f) => uploadImage(f.buffer, f.mimetype)));
      const post = await db.inspirationPost.update({
        where: { id: existing.id },
        data: {
          ...(isBefore
            ? { beforeImageUrls: [...existing.beforeImageUrls, ...urls] }
            : { imageUrls: [...existing.imageUrls, ...urls] }),
          ...resubmitOnEdit(req),
        },
      });
      res.json(post);
    } catch (err) {
      next(err);
    }
  }
);

// Remove one slide by its URL. Sending the URL (rather than an index) keeps
// deletes idempotent and resilient to concurrent reorders. We don't delete the
// S3 object here — it falls out via the bucket lifecycle policy.
router.delete(
  '/:postId/images',
  authMiddleware,
  requireRole('BUSINESS', 'ADMIN'),
  async (req, res, next) => {
    try {
      const business = await requireBusinessOwner(req, res);
      if (!business) return;
      const { url } = z.object({ url: z.string().min(1).max(2000) }).strict().parse(req.body);
      const existing = await loadOwnedPost(business.id, req.params.postId, res);
      if (!existing) return;
      const post = await db.inspirationPost.update({
        where: { id: existing.id },
        data: {
          imageUrls: existing.imageUrls.filter((u) => u !== url),
          beforeImageUrls: existing.beforeImageUrls.filter((u) => u !== url),
          ...resubmitOnEdit(req),
        },
      });
      res.json(post);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
