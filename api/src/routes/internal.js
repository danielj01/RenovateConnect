// Internal/ops endpoints, driven by an external scheduler (Render cron), not by
// app clients. Guarded by INTERNAL_API_KEY sent in the `x-internal-key` header.
//
// The whole router is disabled (404, as though it doesn't exist) when
// INTERNAL_API_KEY is unset, so a misconfigured deploy can't expose an
// unauthenticated trigger — and the 404 doesn't advertise that it exists.

const router = require('express').Router();
const crypto = require('crypto');
const { runListingSweep } = require('../services/listingLifecycle');

// Constant-time compare so the key can't be recovered by timing the response.
function keyMatches(provided) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

router.use((req, res, next) => {
  if (!process.env.INTERNAL_API_KEY) return res.status(404).json({ error: 'Not found' });
  if (!keyMatches(req.headers['x-internal-key'])) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// POST /internal/listing-sweep — send "your free month is ending" and "your
// listing is now hidden" notices. Idempotent: each notice is stamped on the
// business, so re-running (or an overlapping run) won't re-notify.
router.post('/listing-sweep', async (req, res, next) => {
  try {
    const result = await runListingSweep();
    console.log(`[internal] listing sweep: warned=${result.warned} lapsed=${result.lapsed}`);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
