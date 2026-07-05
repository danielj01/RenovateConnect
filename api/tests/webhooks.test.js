// Stripe SDK calls are mocked; we drive handleStripeEvent with synthetic events
// and assert the resulting DB state. One route-level test covers signature
// rejection. The listing-subscription lifecycle + boost activation are handled
// now — the in-app construction-payment webhooks were removed with the payment
// stack. requireActual keeps the price/duration constants the handler reads.
jest.mock('../src/services/stripe', () => {
  const actual = jest.requireActual('../src/services/stripe');
  return { ...actual, constructWebhookEvent: jest.fn() };
});

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
          metadata: { businessId: business.id },
        },
      },
    });
    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.stripeCustomerId).toBe('cus_1');
    expect(updated.proSubscriptionId).toBe('sub_1');
    expect(updated.proStatus).toBe('trialing');
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
          metadata: { businessId: business.id },
        },
      },
    });
    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.proStatus).toBe('active');
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

describe('handleStripeEvent — boost activation', () => {
  const boostSession = (business, id = 'cs_boost_1') => ({
    type: 'checkout.session.completed',
    data: {
      object: {
        id,
        mode: 'payment',
        customer: 'cus_b1',
        amount_total: 500,
        metadata: { businessId: business.id, kind: 'boost' },
      },
    },
  });

  test('a completed boost payment records the boost and sets boostedUntil ~7 days out', async () => {
    const { business } = await createBusiness();
    await handleStripeEvent(boostSession(business));

    const updated = await db.business.findUnique({ where: { id: business.id } });
    const days = (updated.boostedUntil - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    const boosts = await db.boost.findMany({ where: { businessId: business.id } });
    expect(boosts).toHaveLength(1);
    expect(boosts[0].amountCents).toBe(500);
    expect(boosts[0].stripeSessionId).toBe('cs_boost_1');
  });

  test('a replayed boost event is idempotent (no double extension)', async () => {
    const { business } = await createBusiness();
    await handleStripeEvent(boostSession(business));
    const first = (await db.business.findUnique({ where: { id: business.id } })).boostedUntil;

    await handleStripeEvent(boostSession(business)); // same session id replayed
    const second = (await db.business.findUnique({ where: { id: business.id } })).boostedUntil;
    expect(second.getTime()).toBe(first.getTime());
    expect(await db.boost.count({ where: { businessId: business.id } })).toBe(1);
  });

  test('buying while already boosted extends the current run', async () => {
    const { business } = await createBusiness();
    await handleStripeEvent(boostSession(business, 'cs_boost_a'));
    await handleStripeEvent(boostSession(business, 'cs_boost_b'));

    const updated = await db.business.findUnique({ where: { id: business.id } });
    const days = (updated.boostedUntil - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(13.9);
    expect(await db.boost.count({ where: { businessId: business.id } })).toBe(2);
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
