// Stripe SDK calls are mocked; we drive handleStripeEvent with synthetic events
// and assert the resulting DB state. One route-level test covers signature
// rejection.
jest.mock('../src/services/stripe', () => ({
  constructWebhookEvent: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/app');
const stripe = require('../src/services/stripe');
const { handleStripeEvent } = require('../src/routes/webhooks');
const { db, resetDb, createBusiness, createClient } = require('./helpers');

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
});
afterAll(async () => { await db.$disconnect(); });

describe('handleStripeEvent', () => {
  test('an unhandled event type is ignored', async () => {
    await expect(handleStripeEvent({ type: 'payment_intent.created', data: { object: {} } }))
      .resolves.toBeUndefined();
  });

  test('account.updated syncs Connect capability flags', async () => {
    const { business } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { stripeAccountId: 'acct_w' } });

    await handleStripeEvent({
      type: 'account.updated',
      data: { object: { id: 'acct_w', charges_enabled: true, payouts_enabled: true } },
    });

    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.chargesEnabled).toBe(true);
    expect(updated.payoutsEnabled).toBe(true);
  });

  async function pendingPayment() {
    const { user: client } = await createClient();
    const { business } = await createBusiness();
    return db.payment.create({
      data: {
        clientId: client.id, businessId: business.id,
        amountCents: 54000, commissionCents: 4000,
        status: 'PENDING', stripePaymentIntentId: 'pi_w',
      },
    });
  }

  test('checkout.session.completed (payment) settles the deposit via metadata', async () => {
    const payment = await pendingPayment();
    await handleStripeEvent({
      type: 'checkout.session.completed',
      data: { object: { mode: 'payment', payment_intent: 'pi_chk', metadata: { paymentId: payment.id } } },
    });
    const updated = await db.payment.findUnique({ where: { id: payment.id } });
    expect(updated.status).toBe('SUCCEEDED');
    expect(updated.paidAt).not.toBeNull();
    expect(updated.stripePaymentIntentId).toBe('pi_chk');
  });

  test('payment_intent.succeeded marks the deposit SUCCEEDED + paid', async () => {
    const payment = await pendingPayment();
    await handleStripeEvent({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_w' } },
    });
    const updated = await db.payment.findUnique({ where: { id: payment.id } });
    expect(updated.status).toBe('SUCCEEDED');
    expect(updated.paidAt).not.toBeNull();
  });

  test('payment_intent.payment_failed marks the deposit FAILED', async () => {
    const payment = await pendingPayment();
    await handleStripeEvent({
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_w' } },
    });
    const updated = await db.payment.findUnique({ where: { id: payment.id } });
    expect(updated.status).toBe('FAILED');
  });

  test('charge.refunded marks the deposit REFUNDED via the intent id', async () => {
    const payment = await pendingPayment();
    await handleStripeEvent({
      type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_w' } },
    });
    const updated = await db.payment.findUnique({ where: { id: payment.id } });
    expect(updated.status).toBe('REFUNDED');
    expect(updated.refundedAt).not.toBeNull();
  });

  test('a replayed checkout.session.completed cannot resurrect a REFUNDED deposit', async () => {
    const payment = await pendingPayment();
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED', refundedAt: new Date() },
    });
    await handleStripeEvent({
      type: 'checkout.session.completed',
      data: { object: { mode: 'payment', payment_intent: 'pi_chk', metadata: { paymentId: payment.id } } },
    });
    const updated = await db.payment.findUnique({ where: { id: payment.id } });
    expect(updated.status).toBe('REFUNDED');
  });

  test('a late payment_intent.succeeded cannot resurrect a REFUNDED deposit', async () => {
    const payment = await pendingPayment();
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED', refundedAt: new Date() },
    });
    await handleStripeEvent({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_w' } },
    });
    const updated = await db.payment.findUnique({ where: { id: payment.id } });
    expect(updated.status).toBe('REFUNDED');
  });

  test('an out-of-order payment_failed cannot clobber a SUCCEEDED or REFUNDED deposit', async () => {
    const succeeded = await pendingPayment();
    await db.payment.update({ where: { id: succeeded.id }, data: { status: 'SUCCEEDED', paidAt: new Date() } });
    await handleStripeEvent({
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_w' } },
    });
    const after = await db.payment.findUnique({ where: { id: succeeded.id } });
    expect(after.status).toBe('SUCCEEDED');
  });

  test('charge.refunded posts a PAYMENT activity entry for the homeowner', async () => {
    const payment = await pendingPayment();
    await handleStripeEvent({
      type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_w' } },
    });
    const activity = await db.activity.findFirst({
      where: { userId: payment.clientId, type: 'PAYMENT' },
    });
    expect(activity).not.toBeNull();
    expect(activity.title).toBe('Deposit refunded');
    expect(activity.body).toContain('$540.00');
    expect(activity.data).toMatchObject({ paymentId: payment.id });
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
