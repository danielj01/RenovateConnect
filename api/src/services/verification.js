// Business-verification helper. The `Business.verified` flag is derived
// from the contractor's uploaded documents: at least one APPROVED license
// and one APPROVED insurance certificate, both unexpired. Called whenever
// a verification document is approved, rejected, expires, or is deleted.

const db = require('./db');

// Returns true if the business currently has the documents required to be
// considered "verified". An APPROVED doc with no expiresAt is treated as
// always valid; with an expiresAt in the past, treated as expired.
async function hasRequiredApprovedDocs(businessId, now = new Date()) {
  const approved = await db.verificationDocument.findMany({
    where: {
      businessId,
      status: 'APPROVED',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { type: true },
  });
  const types = new Set(approved.map((d) => d.type));
  return types.has('LICENSE') && types.has('INSURANCE');
}

// Recompute `Business.verified` for a single business and persist any change.
// Returns the boolean we ended up with (whether or not it changed).
async function recomputeBusinessVerified(businessId, now = new Date()) {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { id: true, verified: true },
  });
  if (!business) return false;
  const shouldBeVerified = await hasRequiredApprovedDocs(businessId, now);
  if (shouldBeVerified !== business.verified) {
    await db.business.update({
      where: { id: businessId },
      data: {
        verified: shouldBeVerified,
        verifiedAt: shouldBeVerified ? new Date() : null,
      },
    });
  }
  return shouldBeVerified;
}

module.exports = { hasRequiredApprovedDocs, recomputeBusinessVerified };
