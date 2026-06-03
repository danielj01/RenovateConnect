// Stripe SDK calls are mocked; we drive handleStripeEvent with synthetic events
// and assert the resulting DB state. One route-level test covers signature
// rejection.
jest.mock('../src/services/stripe', () => ({
  getSessionCard: jest.fn(),
  retrieveSubscription: jest.fn(),
  constructWebhookEvent: jest.fn(),
  // Unused by these tests but imported by other modules pulled in via app.
  createOrRetrieveCustomer: jest.fn(),
  createSetupCheckoutSession: jest.fn(),
  createSubscriptionCheckoutSession: jest.fn(),
  createLeadInvoiceItem: jest.fn(),
  finalizeAndPayInvoice: jest.fn(),
  cancelSubscription: jest.fn(),
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

describe('handleStripeEvent', () => {
  test('checkout.session.completed (setup) saves the card brand + last4', async () => {
    const { business } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { stripeCustomerId: 'cus_1' } });
    stripe.getSessionCard.mockResolvedValueOnce({ brand: 'mastercard', last4: '5555' });

    await handleStripeEvent({
      type: 'checkout.session.completed',
      data: { object: { mode: 'setup', customer: 'cus_1', setup_intent: 'seti_1' } },
    });

    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.cardBrand).toBe('mastercard');
    expect(updated.cardLast4).toBe('5555');
  });

  test('checkout.session.completed (subscription) stores the subscription id', async () => {
    const { business } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { stripeCustomerId: 'cus_2' } });

    await handleStripeEvent({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', customer: 'cus_2', subscription: 'sub_2' } },
    });

    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.stripeSubId).toBe('sub_2');
  });

  test('invoice.payment_succeeded flips isPromoted and extends promotedUntil', async () => {
    const { business } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { stripeSubId: 'sub_3' } });
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    stripe.retrieveSubscription.mockResolvedValueOnce({ current_period_end: periodEnd });

    await handleStripeEvent({
      type: 'invoice.payment_succeeded',
      data: { object: { subscription: 'sub_3' } },
    });

    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.isPromoted).toBe(true);
    expect(updated.promotedUntil.getTime()).toBe(periodEnd * 1000);
  });

  test('invoice.payment_succeeded without a subscription is a no-op', async () => {
    const { business } = await createBusiness();
    await handleStripeEvent({
      type: 'invoice.payment_succeeded',
      data: { object: { subscription: null } },
    });
    expect(stripe.retrieveSubscription).not.toHaveBeenCalled();
    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.isPromoted).toBe(false);
  });

  test('customer.subscription.deleted unsets promoted state', async () => {
    const { business } = await createBusiness();
    await db.business.update({
      where: { id: business.id },
      data: { isPromoted: true, stripeSubId: 'sub_4', promotedUntil: new Date() },
    });

    await handleStripeEvent({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_4' } },
    });

    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.isPromoted).toBe(false);
    expect(updated.stripeSubId).toBeNull();
    expect(updated.promotedUntil).toBeNull();
  });

  test('an unhandled event type is ignored', async () => {
    await expect(handleStripeEvent({ type: 'payment_intent.created', data: { object: {} } }))
      .resolves.toBeUndefined();
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
