const jwt = require('jsonwebtoken');
const db = require('../src/services/db');

// Wipe all rows between tests so each suite starts clean. Order respects FKs.
async function resetDb() {
  await db.report.deleteMany();
  await db.block.deleteMany();
  await db.dispute.deleteMany();
  await db.verificationDocument.deleteMany();
  await db.payment.deleteMany();
  await db.milestone.deleteMany();
  await db.project.deleteMany();
  await db.portfolioProject.deleteMany();
  await db.quoteRequest.deleteMany();
  await db.activity.deleteMany();
  await db.appointment.deleteMany();
  await db.lead.deleteMany();
  await db.message.deleteMany();
  await db.conversation.deleteMany();
  await db.review.deleteMany();
  await db.estimation.deleteMany();
  await db.sharedEstimate.deleteMany();
  await db.deviceToken.deleteMany();
  await db.favorite.deleteMany();
  await db.savedSearch.deleteMany();
  await db.businessHours.deleteMany();
  await db.business.deleteMany();
  await db.user.deleteMany();
}

function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

async function createClient(overrides = {}) {
  const user = await db.user.create({
    data: {
      email: overrides.email || `client_${Date.now()}_${Math.random()}@test.com`,
      passwordHash: 'x',
      name: overrides.name || 'Test Client',
      role: 'CLIENT',
      phone: overrides.phone,
    },
  });
  return { user, token: tokenFor(user) };
}

async function createAdmin(overrides = {}) {
  const user = await db.user.create({
    data: {
      email: overrides.email || `admin_${Date.now()}_${Math.random()}@test.com`,
      passwordHash: 'x',
      name: overrides.name || 'Test Admin',
      role: 'ADMIN',
    },
  });
  return { user, token: tokenFor(user) };
}

async function createBusiness(overrides = {}) {
  const user = await db.user.create({
    data: {
      email: overrides.email || `biz_${Date.now()}_${Math.random()}@test.com`,
      passwordHash: 'x',
      name: overrides.name || 'Test Owner',
      role: 'BUSINESS',
    },
  });
  const business = await db.business.create({
    data: {
      userId: user.id,
      companyName: overrides.companyName || 'Test Co',
      description: 'We build things.',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      specialties: overrides.specialties || ['Kitchen'],
      // Most suites assume a public, browsable business; default to APPROVED.
      // Pass approvalStatus: 'PENDING' (or 'REJECTED') to exercise the queue.
      approvalStatus: overrides.approvalStatus || 'APPROVED',
      reviewedAt: new Date(),
    },
  });
  return { user, business, token: tokenFor(user) };
}

module.exports = { db, resetDb, tokenFor, createClient, createBusiness, createAdmin };
