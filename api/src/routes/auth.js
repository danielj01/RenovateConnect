const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { createPublicKey } = require('crypto');
const https = require('https');
const db = require('../services/db');
const { authMiddleware } = require('../middleware/auth');

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

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(['CLIENT', 'BUSINESS']),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

router.post('/register', async (req, res, next) => {
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

router.post('/login', async (req, res, next) => {
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
router.post('/apple', async (req, res, next) => {
  try {
    const { identityToken, givenName, familyName, email } = req.body;
    if (!identityToken) return res.status(400).json({ error: 'identityToken required' });

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
  name: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  pushEnabled: z.boolean().optional(),
  notifyLeads: z.boolean().optional(),
  notifyMessages: z.boolean().optional(),
  notifyAppointments: z.boolean().optional(),
  notifyReviews: z.boolean().optional(),
});

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

module.exports = router;
