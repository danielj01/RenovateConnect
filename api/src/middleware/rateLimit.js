// Centralized rate limiting (OWASP API Security — API4:2023 Unrestricted
// Resource Consumption). One place to tune limits; all limiters share a
// graceful JSON 429 and the standard RateLimit-* / Retry-After headers so
// clients can back off cleanly.
const { rateLimit } = require('express-rate-limit');
const jwt = require('jsonwebtoken');

// Graceful, non-leaky 429 (don't reveal limits/among internals).
function rateLimitHandler(_req, res) {
  res.status(429).json({ error: 'Too many requests — please slow down and try again shortly.' });
}

// Key by the authenticated user when a valid bearer token is present (so limits
// follow the user across IPs, and many users behind one NAT aren't throttled as
// a group), otherwise fall back to the client IP. Verification failures fall
// back to IP — an invalid token never raises the limit.
function userOrIpKey(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      if (payload && payload.id) return `user:${payload.id}`;
    } catch { /* fall through to IP */ }
  }
  return req.ip;
}

const common = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  // Never throttle the test suite (it fires many requests from one IP).
  skip: () => process.env.NODE_ENV === 'test',
};

// Baseline cap for the whole API: per-user when authed, per-IP otherwise.
const globalLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  keyGenerator: userOrIpKey,
});

// Strict per-IP cap on credential endpoints (login/register/Apple) to blunt
// brute-force + credential-stuffing. Keyed by IP since there's no trusted user
// yet at sign-in time.
const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
});

module.exports = { globalLimiter, authLimiter, rateLimitHandler, userOrIpKey };
