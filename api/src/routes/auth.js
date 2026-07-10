const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const crypto = require('crypto');
const { createPublicKey } = require('crypto');
const https = require('https');
const db = require('../services/db');
const googleAuth = require('../services/googleAuth');
const { authMiddleware } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { CURRENT_TERMS_VERSION } = require('../services/legal');
const upload = require('../middleware/upload');
const { uploadImage } = require('../services/storage');
const emailService = require('../services/email');

// Email verification + password reset codes: 6-digit, single-use, short-lived.
// Stored hashed (SHA-256) so a DB read can't reveal a live code; low-entropy is
// fine because the code is emailed, expires in 15 min, is single-use, and the
// endpoints sit behind authLimiter (20/15min/IP).
const CODE_TTL_MS = 15 * 60 * 1000;
function generateNumericCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}
function newCode() {
  const code = generateNumericCode();
  return { code, codeHash: hashCode(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) };
}
// When email isn't configured (local dev, CI, tests) and we're not in
// production, surface the code in the response so the flow is testable and the
// app can be built without SendGrid. NEVER returned in production.
function maybeDevCode(code) {
  return (!emailService.isConfigured() && process.env.NODE_ENV !== 'production')
    ? { devCode: code } : {};
}

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
  // Clickwrap: registration requires affirmative agreement to the Terms (and
  // Privacy Policy). Must be exactly `true`, so a client that omits it or sends
  // false is rejected — there is no silent default-accept.
  acceptedTerms: z.literal(true),
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

// Strip every secret/credential field before returning a user row to a client:
// the password hash plus the email-verification and password-reset code hashes
// and their expiries (a code hash is low-entropy and should never be exposed).
function sanitizeUser(user) {
  if (!user) return user;
  delete user.passwordHash;
  delete user.emailVerifyCodeHash;
  delete user.emailVerifyExpiresAt;
  delete user.passwordResetCodeHash;
  delete user.passwordResetExpiresAt;
  return user;
}

// Social sign-in accounts never log in with a password, but the column is
// required — store a hash of high-entropy randomness so the password path can
// never be used to enter the account.
function unguessablePasswordHash() {
  return bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
}

// Find-or-create a user for a social sign-in, keyed on the provider-verified
// email. The email arriving here is always provider-verified (Apple/Google),
// so these accounts are emailVerified from the start. Returns the user row.
async function findOrCreateSocialUser({ email, name }) {
  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    // Creating an account via Apple/Google is itself the act of agreement — the
    // sign-in screen presents the Terms + Privacy links beside the buttons — so
    // we record acceptance of the current terms on first sign-in, the same way
    // /register does.
    user = await db.user.create({
      data: {
        email,
        passwordHash: await unguessablePasswordHash(),
        name,
        role: 'CLIENT',
        emailVerified: true,
        termsAcceptedAt: new Date(),
        termsVersion: CURRENT_TERMS_VERSION,
      },
    });
  } else if (!user.emailVerified) {
    // The account existed but nobody had proven ownership of the address — it
    // may have been pre-registered by an attacker with a password they chose.
    // The provider has now verified the real owner, so mark it verified AND
    // rotate the password to unguessable randomness, neutralizing any password
    // the pre-registrant set. The legitimate owner keeps access via the
    // provider (and can set a new password via reset if they want one).
    user = await db.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        passwordHash: await unguessablePasswordHash(),
        emailVerifyCodeHash: null,
        emailVerifyExpiresAt: null,
      },
    });
  }
  return user;
}

// Answer a social sign-in with the same token payload as /login.
async function socialSignIn(res, { email, name }) {
  const user = await findOrCreateSocialUser({ email, name });
  res.json({ token: signToken(user), user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, 12);
    const { code, codeHash, expiresAt } = newCode();

    const existing = await db.user.findUnique({ where: { email: data.email } });
    // A verified account for this email means a real owner already holds it.
    if (existing && existing.emailVerified) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const shared = {
      passwordHash,
      name: data.name,
      role: data.role,
      phone: data.phone,
      termsAcceptedAt: new Date(),
      termsVersion: CURRENT_TERMS_VERSION,
      emailVerified: false,
      emailVerifyCodeHash: codeHash,
      emailVerifyExpiresAt: expiresAt,
    };

    // If an UNVERIFIED account already exists, nobody proved ownership of the
    // address, so this registration takes it over (overwrite + re-issue a
    // code). This stops an attacker squatting an email to block the real owner.
    const user = existing
      ? await db.user.update({ where: { id: existing.id }, data: shared })
      : await db.user.create({ data: { email: data.email, ...shared } });

    // Fire-and-forget: a send failure must not block signup — the user can
    // resend. In dev/test without SendGrid the code comes back in the response.
    emailService.sendVerificationCode(user.email, code).catch((e) => console.error('[auth] verify email send failed', e.message));

    res.status(201).json({
      needsEmailVerification: true,
      email: user.email,
      ...maybeDevCode(code),
    });
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
    // A password account can't be used until its email is verified — this is
    // what prevents anyone from using an account for an address they don't own.
    // We don't auto-send here (that would spam a code on every attempt and
    // invalidate a just-emailed one); the app routes to the verify screen and
    // calls POST /auth/resend-verification if the user needs a fresh code.
    if (!user.emailVerified) {
      return res.status(403).json({
        error: 'Please verify your email to continue.',
        needsEmailVerification: true,
        email: user.email,
      });
    }
    res.json({ token: signToken(user), user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    next(err);
  }
});

// POST /auth/verify-email — complete registration by confirming the emailed
// code. On success the account is verified and the user is logged in (token).
const verifyEmailSchema = z.object({
  email: z.string().email().max(254),
  code: z.string().min(4).max(12),
}).strict();

router.post('/verify-email', authLimiter, async (req, res, next) => {
  try {
    const { email, code } = verifyEmailSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email } });
    // Uniform response shape; don't reveal whether the email exists.
    const invalid = () => res.status(400).json({ error: 'That code is invalid or has expired.' });
    if (!user || !user.emailVerifyCodeHash || !user.emailVerifyExpiresAt) return invalid();
    if (user.emailVerifyExpiresAt < new Date()) return invalid();
    if (user.emailVerifyCodeHash !== hashCode(code)) return invalid();

    const updated = await db.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifyCodeHash: null, emailVerifyExpiresAt: null },
    });
    res.json({ token: signToken(updated), user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role } });
  } catch (err) {
    next(err);
  }
});

// POST /auth/resend-verification — re-send the code. Always 200 (never reveals
// whether the email exists or is already verified).
const emailOnlySchema = z.object({ email: z.string().email().max(254) }).strict();

router.post('/resend-verification', authLimiter, async (req, res, next) => {
  try {
    const { email } = emailOnlySchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email } });
    let code;
    if (user && !user.emailVerified) {
      const gen = newCode();
      code = gen.code;
      await db.user.update({
        where: { id: user.id },
        data: { emailVerifyCodeHash: gen.codeHash, emailVerifyExpiresAt: gen.expiresAt },
      });
      emailService.sendVerificationCode(user.email, code).catch((e) => console.error('[auth] verify email send failed', e.message));
    }
    res.json({ ok: true, ...(code ? maybeDevCode(code) : {}) });
  } catch (err) {
    next(err);
  }
});

// POST /auth/forgot-password — begin a reset. Always 200 with no indication of
// whether the account exists (prevents email enumeration).
router.post('/forgot-password', authLimiter, async (req, res, next) => {
  try {
    const { email } = emailOnlySchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email } });
    let code;
    if (user) {
      const gen = newCode();
      code = gen.code;
      await db.user.update({
        where: { id: user.id },
        data: { passwordResetCodeHash: gen.codeHash, passwordResetExpiresAt: gen.expiresAt },
      });
      emailService.sendPasswordResetCode(user.email, code).catch((e) => console.error('[auth] reset email send failed', e.message));
    }
    res.json({ ok: true, ...(code ? maybeDevCode(code) : {}) });
  } catch (err) {
    next(err);
  }
});

// POST /auth/reset-password — finish a reset with the emailed code + a new
// password. Succeeding also verifies the email (the code proves ownership) and
// logs the user in.
const resetPasswordSchema = z.object({
  email: z.string().email().max(254),
  code: z.string().min(4).max(12),
  password: z.string().min(8).max(128),
}).strict();

router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const { email, code, password } = resetPasswordSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email } });
    const invalid = () => res.status(400).json({ error: 'That code is invalid or has expired.' });
    if (!user || !user.passwordResetCodeHash || !user.passwordResetExpiresAt) return invalid();
    if (user.passwordResetExpiresAt < new Date()) return invalid();
    if (user.passwordResetCodeHash !== hashCode(code)) return invalid();

    const passwordHash = await bcrypt.hash(password, 12);
    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        emailVerified: true,
        passwordResetCodeHash: null,
        passwordResetExpiresAt: null,
        emailVerifyCodeHash: null,
        emailVerifyExpiresAt: null,
      },
    });
    res.json({ token: signToken(updated), user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role } });
  } catch (err) {
    next(err);
  }
});

// POST /auth/change-password — signed-in user changes their own password.
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
}).strict();

router.post('/change-password', authMiddleware, authLimiter, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { id: req.user.id } });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: 'Your current password is incorrect.' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.user.update({ where: { id: user.id }, data: { passwordHash } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Sign in with Apple
router.post('/apple', authLimiter, async (req, res, next) => {
  try {
    // `email` stays in the schema (clients still send it) but is deliberately
    // not read — see the trust note below.
    const { identityToken, givenName, familyName } = appleSchema.parse(req.body);

    // Decode JWT header to find the key id (kid)
    const [headerB64] = identityToken.split('.');
    const { kid } = JSON.parse(base64urlDecode(headerB64));

    // Verify against Apple's public keys
    const keys = await fetchAppleKeys();
    const jwk = keys.find(k => k.kid === kid);
    if (!jwk) return res.status(401).json({ error: 'Apple public key not found' });

    // Pin the audience to our app's bundle id so an identity token minted for
    // some other app can't authenticate here. APPLE_BUNDLE_ID falls back to
    // APNS_BUNDLE_ID (they're the same id); unset in dev skips the check.
    const appleAudience = process.env.APPLE_BUNDLE_ID || process.env.APNS_BUNDLE_ID;
    let payload;
    try {
      payload = jwt.verify(identityToken, createPublicKey({ key: jwk, format: 'jwk' }), {
        algorithms: ['RS256'],
        issuer: 'https://appleid.apple.com',
        ...(appleAudience ? { audience: appleAudience } : {}),
      });
    } catch {
      return res.status(401).json({ error: 'Invalid Apple identity token' });
    }

    // Only trust the email inside the VERIFIED token (Apple includes it — real
    // or private-relay — whenever the user granted the email scope). The
    // client-supplied `email` is display data at best: keying the account on it
    // would let any Apple user sign in as an arbitrary existing email.
    const userEmail = payload.email || `${payload.sub}@privaterelay.appleid.com`;
    const userName = [givenName, familyName].filter(Boolean).join(' ') || 'Apple User';

    await socialSignIn(res, { email: userEmail, name: userName });
  } catch (err) {
    next(err);
  }
});

// Sign in with Google. The app obtains an OAuth ID token natively and posts it
// here; we verify it against Google's JWKS (issuer + audience + verified email)
// and find-or-create the account exactly like Apple sign-in.
const googleSchema = z.object({
  idToken: z.string().min(1).max(8000),
}).strict();

router.post('/google', authLimiter, async (req, res, next) => {
  try {
    const { idToken } = googleSchema.parse(req.body);
    if (!googleAuth.isConfigured()) {
      return res.status(503).json({ error: 'Google sign-in is not configured' });
    }

    let payload;
    try {
      payload = await googleAuth.verifyGoogleIdToken(idToken);
    } catch {
      return res.status(401).json({ error: 'Invalid Google ID token' });
    }

    await socialSignIn(res, {
      email: payload.email,
      name: payload.name || [payload.given_name, payload.family_name].filter(Boolean).join(' ') || 'Google User',
    });
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
    if (user) {
      sanitizeUser(user);
      // Surface the current terms version + whether this user needs to (re-)accept
      // so the app can gate behind a re-acceptance prompt after a terms update.
      user.currentTermsVersion = CURRENT_TERMS_VERSION;
      user.needsTermsAcceptance = user.termsVersion !== CURRENT_TERMS_VERSION;
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// Record (re-)acceptance of the current Terms of Service. Used when a signed-in
// user is re-prompted after the terms change, keeping an unbroken, timestamped
// chain of assent to the version in force.
router.post('/accept-terms', authMiddleware, async (req, res, next) => {
  try {
    const user = await db.user.update({
      where: { id: req.user.id },
      data: { termsAcceptedAt: new Date(), termsVersion: CURRENT_TERMS_VERSION },
    });
    res.json({ termsVersion: user.termsVersion, termsAcceptedAt: user.termsAcceptedAt });
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
    sanitizeUser(user);
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
    sanitizeUser(user);
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
// Exposed for unit tests (drive the social find-or-create without an HTTP res).
module.exports.socialSignInForTest = findOrCreateSocialUser;
