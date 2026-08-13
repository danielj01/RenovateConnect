// Centralized rate limiting (OWASP API Security — API4:2023 Unrestricted
// Resource Consumption). One place to tune limits; all limiters share a
// graceful JSON 429 and the standard RateLimit-* / Retry-After headers so
// clients can back off cleanly.
const { rateLimit } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const Redis = require('ioredis');
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

// The default store is per-process in-memory, which loses its counts on every
// restart/cold-start/redeploy — on Render's free tier that's frequent enough
// (idle spin-down, deploys) that a fast brute-force script can blow straight
// through the configured limit between resets, verified live against
// production: 25 rapid /auth/login attempts, zero 429s. A shared Redis store
// makes counts durable across restarts and (if this ever scales past one
// instance) consistent across nodes. REDIS_URL is optional: unset, this falls
// back to the in-memory store exactly as before — same behavior local dev has
// always had, so nothing here requires Redis to run the app locally.
let redisClient;
function redisStore(prefix) {
  if (!process.env.REDIS_URL) return undefined;
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL, {
      // Bounds retries so a Redis hiccup can't pile up backpressure — but the
      // offline queue must stay ON: rate-limit-redis sends a setup command
      // (loading its Lua increment script) the moment RedisStore is
      // constructed, before the connection has necessarily finished. With
      // the offline queue disabled that command has nowhere to go and throws
      // synchronously — since this runs at require()-time, that crashes the
      // whole process on boot. Verified locally: this exact combination
      // (offline queue off) crashed api/app.js the instant REDIS_URL was set.
      maxRetriesPerRequest: 1,
    });
    redisClient.on('error', (err) => console.error('[rateLimit] Redis error:', err.message));
  }
  return new RedisStore({
    prefix,
    sendCommand: (...args) => redisClient.call(...args),
  });
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
  store: redisStore('rl:global:'),
});

// Strict per-IP cap on credential endpoints (login/register/Apple) to blunt
// brute-force + credential-stuffing. Keyed by IP since there's no trusted user
// yet at sign-in time.
const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
  store: redisStore('rl:auth:'),
});

module.exports = { globalLimiter, authLimiter, rateLimitHandler, userOrIpKey };
