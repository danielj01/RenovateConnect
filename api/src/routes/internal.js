const express = require('express');
const projectRoutes = require('./projects');

const router = express.Router();

// Internal/ops endpoints meant to be driven by an external scheduler (e.g. a
// Render Cron Job or GitHub Actions cron), not by app clients. Guarded by a
// shared secret in the `x-internal-key` header rather than user auth.
//
// If INTERNAL_API_KEY is unset the endpoints are disabled (503) so this is never
// an open door — you must opt in by setting the secret in the environment.
function requireInternalKey(req, res, next) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    return res.status(503).json({ error: 'Internal API disabled (INTERNAL_API_KEY not set)' });
  }
  const provided = req.get('x-internal-key');
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'Invalid internal key' });
  }
  return next();
}

// Release milestone funds the homeowner left un-actioned past the grace window.
// Idempotent: re-running only affects milestones still eligible, so it's safe to
// call on whatever cadence the scheduler uses.
router.post('/sweep', requireInternalKey, async (_req, res, next) => {
  try {
    const released = await projectRoutes.autoReleaseStaleMilestones();
    res.json({ ok: true, released });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
