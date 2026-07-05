// Stripe SDK calls are mocked; we drive handleStripeEvent with synthetic events
// and assert the resulting DB state. One route-level test covers signature
// rejection. Only the Pro subscription lifecycle is handled now — the in-app
// construction-payment webhooks were removed with the payment stack.
jest.mock('../src/services/stripe', () => ({
  constructWebhookEvent: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/app');
const stripe = require('../src/services/stripe');
const { handleStripeEvent } = require('../src/routes/webhooks');
const { db, resetDb, createBusiness } = require('./helpers');

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
});
afterAll(async () => { await db.$disconnect(); });

describe('handleStripeEvent — Pro subscription lifecycle', () => {
  test('an unhandled event type is ignored', async () => {
    await expect(handleStripeEvent({ type: 'payment_intent.created', data: { object: {} } }))
      .resolves.toBeUndefined();
  });

  test('checkout.session.completed (subscription) links the customer + subscription to the business', async () => {
    const { business } = await createBusiness();
    await handleStripeEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { businessId: business.id, plan: 'sponsored' },
        },
      },
    });
    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.stripeCustomerId).toBe('cus_1');
    expect(updated.proSubscriptionId).toBe('sub_1');
    expect(updated.proStatus).toBe('trialing');
    expect(updated.proPlan).toBe('sponsored');
  });

  test('customer.subscription.updated mirrors status + period onto the business', async () => {
    const { business } = await createBusiness();
    await handleStripeEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_2',
          customer: 'cus_2',
          status: 'active',
          trial_end: null,
          current_period_end: 1893456000,
          metadata: { businessId: business.id, plan: 'insights' },
        },
      },
    });
    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.proStatus).toBe('active');
    expect(updated.proPlan).toBe('insights');
    expect(updated.proSubscriptionId).toBe('sub_2');
  });

  test('customer.subscription.deleted flips the business to canceled', async () => {
    const { business } = await createBusiness();
    await db.business.update({
      where: { id: business.id },
      data: { proSubscriptionId: 'sub_3', proStatus: 'active' },
    });
    await handleStripeEvent({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_3' } },
    });
    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.proStatus).toBe('canceled');
  });
});

describe('POST /webhooks/stripe', () => {
  test('rejects an invalid signature with 400', async () => {
    stripe.constructWebhookEvent.mockImplementationOnce(() => { throw new Error('bad sig'); });
    const res = await request(app).post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send({ type: 'whatever' });
    expect(res.status).toBe(400);
  });

  test('acknowledges a valid event', async () => {
    stripe.constructWebhookEvent.mockReturnValueOnce({
      type: 'payment_intent.created',
      data: { object: {} },
    });
    const res = await request(app).post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send({ type: 'payment_intent.created' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});
