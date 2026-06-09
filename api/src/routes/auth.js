const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { createPublicKey } = require('crypto');
const https = require('https');
const db = require('../services/db');
const { authMiddleware } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const upload = require('../middleware/upload');
const { uploadImage } = require('../services/storage');

// Fetch Apple's public JWK keys (used to verify identity tokens)
function fetchAppleKeys() {
  return new Promise((resolve, reject) => {
    https.get('https://appleid.apple.com/auth/keys', res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve(JSON.parse(data).keys));
      res.on('error', reject);
    });
  });
}

function base64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '='), 'base64').toString();
}

// .strict() rejects unexpected fields (defense against mass-assignment + junk
// input). Lengths are capped to bound storage + cost (e.g. bcrypt input).
const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
  role: z.enum(['CLIENT', 'BUSINESS']),
  phone: z.string().max(30).optional(),
}).strict();

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
}).strict();

// Apple sign-in payload (was previously read off req.body unvalidated).
const appleSchema = z.object({
  identityToken: z.string().min(1).max(8000),
  givenName: z.string().max(100).nullish(),
  familyName: z.string().max(100).nullish(),
  email: z.string().email().max(254).nullish(),
}).strict();

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await db.user.create({
      data: { email: data.email, passwordHash, name: data.name, role: data.role, phone: data.phone },
    });
    res.status(201).json({ token: signToken(user), user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Email already in use' });
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ token: signToken(user), user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    next(err);
  }
});

// Sign in with Apple
router.post('/apple', authLimiter, async (req, res, next) => {
  try {
    const { identityToken, givenName, familyName, email } = appleSchema.parse(req.body);

    // Decode JWT header to find the key id (kid)
    const [headerB64] = identityToken.split('.');
    const { kid } = JSON.parse(base64urlDecode(headerB64));

    // Verify against Apple's public keys
    const keys = await fetchAppleKeys();
    const jwk = keys.find(k => k.kid === kid);
    if (!jwk) return res.status(401).json({ error: 'Apple public key not found' });

    let payload;
    try {
      payload = jwt.verify(identityToken, createPublicKey({ key: jwk, format: 'jwk' }), {
        algorithms: ['RS256'],
        issuer: 'https://appleid.apple.com',
      });
    } catch {
      return res.status(401).json({ error: 'Invalid Apple identity token' });
    }

    // Apple only provides email on first sign-in — fall back to relay address
    const userEmail = email || payload.email || `${payload.sub}@privaterelay.appleid.com`;
    const userName = [givenName, familyName].filter(Boolean).join(' ') || 'Apple User';

    // Find existing account or create one
    let user = await db.user.findUnique({ where: { email: userEmail } });
    if (!user) {
      user = await db.user.create({
        data: {
          email: userEmail,
          passwordHash: await bcrypt.hash(payload.sub, 10),
          name: userName,
          role: 'CLIENT',
        },
      });
    }

    res.json({ token: signToken(user), user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await db.user.findUnique({
      where: { id: req.user.id },
      include: { business: true },
    });
    if (user) delete user.passwordHash;
    res.json(user);
  } catch (err) {
    next(err);
  }
});

const updateMeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().max(30).nullable().optional(),
  avatarUrl: z.string().url().max(2000).nullable().optional(),
  pushEnabled: z.boolean().optional(),
  notifyLeads: z.boolean().optional(),
  notifyMessages: z.boolean().optional(),
  notifyAppointments: z.boolean().optional(),
  notifyReviews: z.boolean().optional(),
}).strict();

// PATCH /me — update the current user's editable profile fields / preferences.
router.patch('/me', authMiddleware, async (req, res, next) => {
  try {
    const data = updateMeSchema.parse(req.body);
    const user = await db.user.update({
      where: { id: req.user.id },
      data,
      include: { business: true },
    });
    delete user.passwordHash;
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// POST /me/avatar — upload a new profile picture (multipart, single image).
// Stores the file in S3 and saves the resulting URL on the user, returning the
// refreshed user so the client can rebind without a second fetch.
router.post('/me/avatar', authMiddleware, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'image required' });
    const avatarUrl = await uploadImage(req.file.buffer, req.file.mimetype, `${req.protocol}://${req.get('host')}`);
    const user = await db.user.update({
      where: { id: req.user.id },
      data: { avatarUrl },
      include: { business: true },
    });
    delete user.passwordHash;
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// DELETE /me — permanently delete the current user's account and all their data.
// Several relations (conversations, messages, leads, estimations) don't cascade
// from the user, so we tear them down explicitly in dependency order inside a
// transaction; the remaining records (business + its children, payments,
// favorites, device tokens, activities, appointments, quote requests) cascade
// when the user row is deleted. This is irreversible.
router.delete('/me', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const business = await db.business.findUnique({ where: { userId }, select: { id: true } });
    const businessId = business?.id;

    await db.$transaction(async (tx) => {
      // Conversations the user takes part in — as the homeowner, and (if they
      // own a business) as the contractor. Their leads and messages must go
      // first because those foreign keys don't cascade.
      const convs = await tx.conversation.findMany({
        where: {
          OR: [{ clientId: userId }, ...(businessId ? [{ businessId }] : [])],
        },
        select: { id: true },
      });
      const convIds = convs.map((c) => c.id);

      if (convIds.length) {
        await tx.lead.deleteMany({ where: { conversationId: { in: convIds } } });
        await tx.message.deleteMany({ where: { conversationId: { in: convIds } } });
        await tx.conversation.deleteMany({ where: { id: { in: convIds } } });
      }
      // Defensive: any leads still tied to the business (should be none left).
      if (businessId) await tx.lead.deleteMany({ where: { businessId } });
      // Messages the user sent elsewhere, plus their AI estimations.
      await tx.message.deleteMany({ where: { senderId: userId } });
      await tx.estimation.deleteMany({ where: { userId } });

      await tx.user.delete({ where: { id: userId } });
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
