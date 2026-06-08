// Mock the Stripe SDK-calling functions; keep everything else real.
jest.mock('../src/services/stripe', () => {
  const actual = jest.requireActual('../src/services/stripe');
  return {
    ...actual,
    createProCheckoutSession: jest.fn(async () => ({ url: 'https://checkout.test/pro' })),
    cancelProSubscription: jest.fn(async () => ({ id: 'sub_1', cancel_at_period_end: true })),
  };
});

const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness, createClient } = require('./helpers');
const { handleStripeEvent } = require('../src/routes/webhooks');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

describe('Pro subscription', () => {
  test('subscribe returns a checkout URL', async () => {
    const { token } = await createBusiness();
    const res = await request(app).post('/payments/pro/subscribe').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\//);
  });

  test('clients cannot subscribe (403)', async () => {
    const { token } = await createClient();
    const res = await request(app).post('/payments/pro/subscribe').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('status reflects an active subscription set via webhook', async () => {
    const { business, token } = await createBusiness();

    await handleStripeEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'trialing',
          trial_end: Math.floor(Date.now() / 1000) + 90 * 86400,
          current_period_end: Math.floor(Date.now() / 1000) + 90 * 86400,
          metadata: { businessId: business.id },
        },
      },
    });

    const res = await request(app).get('/payments/pro/status').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.isPro).toBe(true);
    expect(res.body.status).toBe('trialing');

    const fresh = await db.business.findUnique({ where: { id: business.id } });
    expect(fresh.proSubscriptionId).toBe('sub_123');
    expect(fresh.stripeCustomerId).toBe('cus_123');
  });

  test('subscribe is blocked when already active (409)', async () => {
    const { business, token } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { proStatus: 'active', proSubscriptionId: 'sub_x' } });
    const res = await request(app).post('/payments/pro/subscribe').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
  });

  test('cancel works when subscribed; deleted webhook flips to canceled', async () => {
    const { business, token } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { proStatus: 'active', proSubscriptionId: 'sub_z' } });

    const cancel = await request(app).post('/payments/pro/cancel').set('Authorization', `Bearer ${token}`);
    expect(cancel.status).toBe(200);

    await handleStripeEvent({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_z' } },
    });
    const fresh = await db.business.findUnique({ where: { id: business.id } });
    expect(fresh.proStatus).toBe('canceled');
  });
});
