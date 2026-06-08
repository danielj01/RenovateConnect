const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness, createClient } = require('./helpers');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

async function insightsBusiness() {
  const { business, token } = await createBusiness();
  await db.business.update({
    where: { id: business.id },
    data: { proStatus: 'active', proPlan: 'insights' },
  });
  return { business, token };
}

async function seedDemand() {
  const { user } = await createClient({ email: `seed_${Math.random()}@t.com` });
  // 6 Kitchen saved searches (above the suppression threshold of 5)…
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await db.savedSearch.create({ data: { userId: user.id, specialty: 'Kitchen', city: 'Oakland', state: 'CA' } });
  }
  // …and only 3 Bathroom (below threshold → suppressed).
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await db.savedSearch.create({ data: { userId: user.id, specialty: 'Bathroom', city: 'Berkeley', state: 'CA' } });
  }
}

describe('Pro Insights tier', () => {
  test('insights plan gets aggregated demand with small buckets suppressed', async () => {
    const { token } = await insightsBusiness();
    await seedDemand();

    const res = await request(app).get('/payments/pro/insights').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const cats = res.body.demandByCategory.map((c) => c.label);
    expect(cats).toContain('Kitchen');      // 6 ≥ 5
    expect(cats).not.toContain('Bathroom'); // 3 < 5, suppressed

    const kitchen = res.body.demandByCategory.find((c) => c.label === 'Kitchen');
    expect(kitchen.count).toBe(6);

    // Coarse area demand is city-level (Oakland), never an individual address.
    expect(res.body.demandByArea.map((a) => a.label)).toContain('Oakland, CA');
    expect(res.body.minBucket).toBe(5);
    expect(res.body.performance).toBeDefined();
  });

  test('sponsored ($5) plan cannot access insights (403)', async () => {
    const { business, token } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { proStatus: 'active', proPlan: 'sponsored' } });
    const res = await request(app).get('/payments/pro/insights').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('non-subscriber cannot access insights (403)', async () => {
    const { token } = await createBusiness();
    const res = await request(app).get('/payments/pro/insights').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('status reports the plan and hasInsights flag', async () => {
    const { token } = await insightsBusiness();
    const res = await request(app).get('/payments/pro/status').set('Authorization', `Bearer ${token}`);
    expect(res.body.plan).toBe('insights');
    expect(res.body.hasInsights).toBe(true);
    expect(res.body.isPro).toBe(true);
  });
});
