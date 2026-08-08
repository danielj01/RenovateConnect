// Contractor identity-verification documents (license, insurance, optional ID).
//
//   POST   /businesses/:id/verification-documents       (BUSINESS owner) upload
//   GET    /businesses/:id/verification-documents       (owner or ADMIN) list
//   DELETE /businesses/:id/verification-documents/:doc  (owner) — PENDING only
//
// Admin queue + decisions live in routes/admin.js. `Business.verified` is
// recomputed on every admin decision via services/verification.js.

const router = require('express').Router({ mergeParams: true });
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const documentUpload = require('../middleware/documentUpload');
const { uploadFile, uploadPrivateFile, presignedUrlFor, s3Configured } = require('../services/storage');

// Documents are private (they include government IDs), so we never return a
// durable link. When the row has a private `storageKey` we mint a short-lived
// presigned URL at read time; legacy rows (and local dev without S3) fall back
// to the stored `fileUrl`.
async function withReadableUrl(doc) {
  const signed = await presignedUrlFor(doc.storageKey);
  return { ...doc, fileUrl: signed || doc.fileUrl };
}

const DOC_TYPES = ['LICENSE', 'INSURANCE', 'IDENTITY'];

// Ownership check — copy of requireBusinessOwner from businesses.js so this
// router can stand alone with mergeParams (:id comes from the parent path).
async function requireBusinessOwner(req, res) {
  const business = await db.business.findUnique({ where: { id: req.params.id } });
  if (!business) { res.status(404).json({ error: 'Not found' }); return null; }
  if (business.userId !== req.user.id && req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' }); return null;
  }
  return business;
}

// POST — multipart: { file, type, documentNumber?, issuer?, expiresAt? (ISO) }.
router.post('/', authMiddleware, requireRole('BUSINESS', 'ADMIN'),
            documentUpload.single('file'), async (req, res, next) => {
  try {
    const business = await requireBusinessOwner(req, res);
    if (!business) return;
    if (!req.file) return res.status(400).json({ error: 'A file is required' });

    const { type, documentNumber, issuer, expiresAt } = z.object({
      type:           z.enum(DOC_TYPES),
      documentNumber: z.string().trim().max(120).optional(),
      issuer:         z.string().trim().max(120).optional(),
      // ISO date string. Insurance always has one; we still allow empty for
      // licenses that don't expire.
      expiresAt:      z.string().datetime().optional(),
    }).parse(req.body);

    // Private prefix in prod. Local dev without S3 has no private store — the
    // uploads dir is served publicly — so it falls back to the ordinary path
    // rather than failing; production can't boot without S3 anyway.
    let storageKey = null;
    let fileUrl;
    if (s3Configured()) {
      storageKey = await uploadPrivateFile(req.file.buffer, req.file.mimetype);
      // Nothing durable to store: reads go through a presigned URL.
      fileUrl = '';
    } else {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      fileUrl = await uploadFile(req.file.buffer, req.file.mimetype, baseUrl);
    }

    const doc = await db.verificationDocument.create({
      data: {
        businessId: business.id,
        type,
        fileUrl,
        storageKey,
        documentNumber: documentNumber || null,
        issuer: issuer || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });
    res.status(201).json(await withReadableUrl(doc));
  } catch (err) {
    next(err);
  }
});

// GET — owner sees their full history; admin can fetch any business's history.
router.get('/', authMiddleware, requireRole('BUSINESS', 'ADMIN'), async (req, res, next) => {
  try {
    const business = await requireBusinessOwner(req, res);
    if (!business) return;
    const docs = await db.verificationDocument.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(await Promise.all(docs.map(withReadableUrl)));
  } catch (err) {
    next(err);
  }
});

// DELETE — owner can withdraw a PENDING upload they no longer want reviewed.
// Approved/Rejected docs are kept as an audit trail.
router.delete('/:docId', authMiddleware, requireRole('BUSINESS', 'ADMIN'),
              async (req, res, next) => {
  try {
    const business = await requireBusinessOwner(req, res);
    if (!business) return;
    const doc = await db.verificationDocument.findUnique({ where: { id: req.params.docId } });
    if (!doc || doc.businessId !== business.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (doc.status !== 'PENDING') {
      return res.status(409).json({ error: 'Only pending uploads can be deleted.' });
    }
    await db.verificationDocument.delete({ where: { id: doc.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
