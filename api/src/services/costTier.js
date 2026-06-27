// Contractor price level. `Business.costTier` is derived from the cost ranges
// the contractor posts on their approved portfolio projects: we take the
// midpoint of each project's [costMin, costMax], average them, and bucket that
// into LOW / MEDIUM / HIGH. We also store the average posted range so the UI can
// show the real number ("$$ · typically $20k–$45k"), not just an opaque badge.
//
// Recomputed whenever a portfolio project is created, edited, deleted, or its
// approval status changes — same lifecycle pattern as services/verification.js.

const db = require('./db');

// Thresholds in dollars, env-tunable. A midpoint <= LOW_MAX is LOW; >= HIGH_MIN
// is HIGH; anything between is MEDIUM. Defaults reflect typical renovation spend.
const LOW_MAX = () => Number(process.env.COST_TIER_LOW_MAX || 15000);
const HIGH_MIN = () => Number(process.env.COST_TIER_HIGH_MIN || 50000);

function tierForMidpoint(avgMidpoint) {
  if (avgMidpoint <= LOW_MAX()) return 'LOW';
  if (avgMidpoint >= HIGH_MIN()) return 'HIGH';
  return 'MEDIUM';
}

// Recompute and persist the tier for one business. Only approved portfolio
// projects that have BOTH costMin and costMax set count. Returns the new tier
// (or null when there isn't enough data).
async function recomputeBusinessCostTier(businessId) {
  const projects = await db.portfolioProject.findMany({
    where: {
      businessId,
      approvalStatus: 'APPROVED',
      costMin: { not: null },
      costMax: { not: null },
    },
    select: { costMin: true, costMax: true },
  });

  if (projects.length === 0) {
    await db.business.update({
      where: { id: businessId },
      data: { costTier: null, typicalCostLow: null, typicalCostHigh: null, costSamples: 0 },
    });
    return null;
  }

  const midpoints = projects.map((p) => (p.costMin + p.costMax) / 2);
  const avgMidpoint = midpoints.reduce((a, b) => a + b, 0) / midpoints.length;
  const avgLow = Math.round(projects.reduce((a, p) => a + p.costMin, 0) / projects.length);
  const avgHigh = Math.round(projects.reduce((a, p) => a + p.costMax, 0) / projects.length);
  const tier = tierForMidpoint(avgMidpoint);

  await db.business.update({
    where: { id: businessId },
    data: {
      costTier: tier,
      typicalCostLow: avgLow,
      typicalCostHigh: avgHigh,
      costSamples: projects.length,
    },
  });
  return tier;
}

module.exports = { recomputeBusinessCostTier, tierForMidpoint };
