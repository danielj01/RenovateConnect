const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness, createAdmin } = require('./helpers');
const { recomputeBusinessCostTier, tierForMidpoint } = require('../src/services/costTier');

beforeEach(async () => {
  await resetDb();
  process.env.COST_TIER_LOW_MAX = '15000';
  process.env.COST_TIER_HIGH_MIN = '50000';
});
afterAll(async () => { await db.$disconnect(); });

async function addProject(businessId, costMin, costMax, status = 'APPROVED') {
  return db.portfolioProject.create({
    data: { businessId, title: 'P', costMin, costMax, approvalStatus: status },
  });
}

describe('tierForMidpoint thresholds', () => {
  test('buckets by midpoint', () => {
    expect(tierForMidpoint(8000)).toBe('LOW');
    expect(tierForMidpoint(15000)).toBe('LOW');   // boundary inclusive
    expect(tierForMidpoint(30000)).toBe('MEDIUM');
    expect(tierForMidpoint(50000)).toBe('HIGH');  // boundary inclusive
    expect(tierForMidpoint(120000)).toBe('HIGH');
  });
});

describe('recomputeBusinessCostTier', () => {
  test('LOW when typical project is cheap; stores the average range + sample count', async () => {
    const { business } = await createBusiness();
    await addProject(business.id, 8000, 12000);   // mid 10k
    await addProject(business.id, 10000, 14000);  // mid 12k

    const tier = await recomputeBusinessCostTier(business.id);
    expect(tier).toBe('LOW');

    const b = await db.business.findUnique({ where: { id: business.id } });
    expect(b.costTier).toBe('LOW');
    expect(b.typicalCostLow).toBe(9000);   // avg of 8000, 10000
    expect(b.typicalCostHigh).toBe(13000); // avg of 12000, 14000
    expect(b.costSamples).toBe(2);
  });

  test('HIGH when typical project is expensive', async () => {
    const { business } = await createBusiness();
    await addProject(business.id, 80000, 120000);
    expect(await recomputeBusinessCostTier(business.id)).toBe('HIGH');
  });

  test('MEDIUM in between', async () => {
    const { business } = await createBusiness();
    await addProject(business.id, 20000, 40000); // mid 30k
    expect(await recomputeBusinessCostTier(business.id)).toBe('MEDIUM');
  });

  test('only APPROVED projects with a full cost range count', async () => {
    const { business } = await createBusiness();
    await addProject(business.id, 90000, 110000, 'PENDING'); // ignored (pending)
    await addProject(business.id, 9000, 11000, 'APPROVED');  // counts
    await db.portfolioProject.create({                        // ignored (no cost)
      data: { businessId: business.id, title: 'NoCost', approvalStatus: 'APPROVED' },
    });

    const tier = await recomputeBusinessCostTier(business.id);
    expect(tier).toBe('LOW');
    const b = await db.business.findUnique({ where: { id: business.id } });
    expect(b.costSamples).toBe(1);
  });

  test('no cost data → null tier and zeroed fields', async () => {
    const { business } = await createBusiness();
    await db.business.update({
      where: { id: business.id },
      data: { costTier: 'HIGH', typicalCostLow: 1, typicalCostHigh: 2, costSamples: 3 },
    });
    const tier = await recomputeBusinessCostTier(business.id);
    expect(tier).toBeNull();
    const b = await db.business.findUnique({ where: { id: business.id } });
    expect(b.costTier).toBeNull();
    expect(b.typicalCostLow).toBeNull();
    expect(b.costSamples).toBe(0);
  });
});

describe('Recompute hooks via the API', () => {
  test('creating + editing a portfolio project refreshes the tier', async () => {
    const { business, token } = await createBusiness();

    // Owner-created projects start PENDING; approve via admin to make them count.
    const create = await request(app).post(`/businesses/${business.id}/portfolio`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Kitchen', costMin: 10000, costMax: 14000 });
    expect(create.status).toBe(201);

    const { token: adminToken } = await createAdmin();
    await request(app).post(`/admin/portfolio/${create.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);

    let b = await db.business.findUnique({ where: { id: business.id } });
    expect(b.costTier).toBe('LOW');

    // Edit the cost way up → tier moves to HIGH.
    await request(app).put(`/businesses/${business.id}/portfolio/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ costMin: 80000, costMax: 120000 }).expect(200);

    b = await db.business.findUnique({ where: { id: business.id } });
    expect(b.costTier).toBe('HIGH');
  });

  test('rejecting a previously-approved project drops it from the tier', async () => {
    const { business } = await createBusiness();
    const p = await addProject(business.id, 80000, 120000, 'APPROVED');
    await recomputeBusinessCostTier(business.id);
    expect((await db.business.findUnique({ where: { id: business.id } })).costTier).toBe('HIGH');

    const { token: adminToken } = await createAdmin();
    await request(app).post(`/admin/portfolio/${p.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'bad photos' }).expect(200);

    const b = await db.business.findUnique({ where: { id: business.id } });
    expect(b.costTier).toBeNull();
  });
});

describe('Search surfaces + filters by cost tier', () => {
  test('search returns the tier + typical range, and ?costTier filters', async () => {
    const low = await createBusiness({ email: 'low@t.com', companyName: 'Budget Builders' });
    await addProject(low.business.id, 8000, 12000);
    await recomputeBusinessCostTier(low.business.id);

    const high = await createBusiness({ email: 'high@t.com', companyName: 'Luxe Renovations' });
    await addProject(high.business.id, 90000, 130000);
    await recomputeBusinessCostTier(high.business.id);

    const all = await request(app).get('/businesses');
    expect(all.status).toBe(200);
    const byName = Object.fromEntries(all.body.businesses.map((b) => [b.companyName, b]));
    expect(byName['Budget Builders'].costTier).toBe('LOW');
    expect(byName['Budget Builders'].typicalCostLow).toBe(8000);
    expect(byName['Luxe Renovations'].costTier).toBe('HIGH');

    const filtered = await request(app).get('/businesses?costTier=HIGH');
    const names = filtered.body.businesses.map((b) => b.companyName);
    expect(names).toContain('Luxe Renovations');
    expect(names).not.toContain('Budget Builders');
  });
});
