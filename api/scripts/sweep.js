// Milestone auto-release sweep, run as a scheduled job (Render Cron). Reuses the
// same idempotent logic as the in-process timer + POST /internal/sweep, but runs
// directly against the DB so it works cleanly across multiple API instances.
//
// Usage: node scripts/sweep.js  (needs DATABASE_URL and STRIPE_SECRET_KEY).
const { autoReleaseStaleMilestones } = require('../src/routes/projects');
const db = require('../src/services/db');

(async () => {
  try {
    const n = await autoReleaseStaleMilestones();
    console.log(`[sweep] auto-released ${n} milestone(s)`);
  } catch (err) {
    console.error('[sweep] failed', err);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
})();
