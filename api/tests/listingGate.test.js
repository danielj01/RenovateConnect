// The $10/mo listing subscription model: a business is publicly visible while
// its free first month runs (freeListingEndsAt, stamped at first admin
// approval) or while its subscription is trialing/active. Lapsed businesses
// disappear from search, the feed, and public profiles — but stay visible to
// their owner and admins, and pop back the moment the subscription is live.

jest.mock('../src/services/stripe', () => {
  const actual = jest.requireActual('../src/services/stripe');
  return {
    ...actual,
    createProCheckoutSession: jest.fn(async () => ({ url: 'https://checkout.test/pro' })),
    createBoostCheckoutSession: jest.fn(async () => ({ url: 'https://checkout.test/boost' })),
  };
});

const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness, createAdmin, createClient } = require('./helpers');
const { createBoostCheckoutSession } = require('../src/services/stripe');

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
});
afterAll(async () => { await db.$disconnect(); });

const PAST = new Date(Date.now() - 1000);
const FUTURE = new Date(Date.now() + 7 * 86400000);

// An approved business whose free month is over and who has no subscription.
async function lapsedBusiness(overrides = {}) {
  return createBusiness({ freeListingEndsAt: PAST, ...overrides });
}

describe('Listing gate — search', () => {
  test('a business in its free month is listed', async () => {
    await createBusiness({ companyName: 'FreeMonthCo' });
    const res = await request(app).get('/businesses');
    expect(res.body.businesses.map((b) => b.companyName)).toContain('FreeMonthCo');
  });

  test('a lapsed business (free month over, no subscription) is hidden from search', async () => {
    await lapsedBusiness({ companyName: 'LapsedCo' });
    const res = await request(app).get('/businesses');
    expect(res.body.businesses.map((b) => b.companyName)).not.toContain('LapsedCo');
    expect(res.body.total).toBe(0);
  });

  test('a lapsed business with an active subscription is listed again', async () => {
    const { business } = await lapsedBusiness({ companyName: 'PayingCo' });
    await db.business.update({ where: { id: business.id }, data: { proStatus: 'active' } });
    const res = await request(app).get('/businesses');
    expect(res.body.businesses.map((b) => b.companyName)).toContain('PayingCo');
  });

  test('a canceled subscription after the free month means hidden', async () => {
    const { business } = await lapsedBusiness({ companyName: 'CanceledCo' });
    await db.business.update({ where: { id: business.id }, data: { proStatus: 'canceled' } });
    const res = await request(app).get('/businesses');
    expect(res.body.businesses).toHaveLength(0);
  });
});

describe('Listing gate — public profile', () => {
  test('a lapsed business 404s publicly but stays visible to its owner and admins', async () => {
    const { business, token } = await lapsedBusiness();

    const anon = await request(app).get(`/businesses/${business.id}`);
    expect(anon.status).toBe(404);

    const owner = await request(app).get(`/businesses/${business.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(owner.status).toBe(200);

    const { token: adminToken } = await createAdmin();
    const admin = await request(app).get(`/businesses/${business.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(admin.status).toBe(200);
  });
});

describe('Listing gate — inspiration feed', () => {
  test("a lapsed business's approved portfolio photos leave the feed", async () => {
    const { business } = await lapsedBusiness();
    await db.portfolioProject.create({
      data: {
        businessId: business.id,
        title: 'Hidden kitchen',
        imageUrls: ['https://img.test/1.jpg'],
        approvalStatus: 'APPROVED',
      },
    });
    const res = await request(app).get('/feed');
    expect(res.body.items).toHaveLength(0);
  });
});

describe('Admin approval stamps the free month', () => {
  test('first approval sets freeListingEndsAt ~30 days out; re-approval does not restart it', async () => {
    const { business } = await createBusiness({
      approvalStatus: 'PENDING',
      freeListingEndsAt: null,
    });
    const { token: adminToken } = await createAdmin();

    const res = await request(app).post(`/admin/businesses/${business.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const stamped = new Date(res.body.freeListingEndsAt);
    const days = (stamped - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    // Approve again — the clock must not restart.
    const again = await request(app).post(`/admin/businesses/${business.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(new Date(again.body.freeListingEndsAt).getTime()).toBe(stamped.getTime());
  });
});

describe('POST /payments/boost', () => {
  test('a listed business gets a checkout URL', async () => {
    const { token } = await createBusiness();
    const res = await request(app).post('/payments/boost').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\//);
    expect(createBoostCheckoutSession).toHaveBeenCalled();
  });

  test('a delisted business cannot buy a boost (409)', async () => {
    const { token } = await lapsedBusiness();
    const res = await request(app).post('/payments/boost').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(createBoostCheckoutSession).not.toHaveBeenCalled();
  });

  test('the per-city slot cap blocks a purchase when full (409)', async () => {
    // Three businesses in the default city (Austin, TX) already hold boosts.
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { business } = await createBusiness({ email: `full${i}@t.com` });
      // eslint-disable-next-line no-await-in-loop
      await db.business.update({ where: { id: business.id }, data: { boostedUntil: FUTURE } });
    }
    const { token } = await createBusiness({ email: 'wants-boost@t.com' });
    const res = await request(app).post('/payments/boost').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/slots/i);
  });

  test('extending your own running boost is allowed even when the cap is otherwise full', async () => {
    for (let i = 0; i < 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { business } = await createBusiness({ email: `other${i}@t.com` });
      // eslint-disable-next-line no-await-in-loop
      await db.business.update({ where: { id: business.id }, data: { boostedUntil: FUTURE } });
    }
    const { business, token } = await createBusiness({ email: 'extender@t.com' });
    await db.business.update({ where: { id: business.id }, data: { boostedUntil: FUTURE } });

    // 3 active boosts in Austin, but one is ours — extension allowed.
    const res = await request(app).post('/payments/boost').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('clients cannot buy boosts (403)', async () => {
    const { token } = await createClient();
    const res = await request(app).post('/payments/boost').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
