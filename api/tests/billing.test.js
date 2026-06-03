// Stripe is fully mocked — these tests verify our billing orchestration (DB
// state, idempotency, routing/authz) without touching the network.
jest.mock('../src/services/stripe', () => ({
  createOrRetrieveCustomer: jest.fn(async () => ({ id: 'cus_test' })),
  createSetupCheckoutSession: jest.fn(async () => ({ url: 'https://checkout.stripe.com/setup-session' })),
  createSubscriptionCheckoutSession: jest.fn(async () => ({ url: 'https://checkout.stripe.com/sub-session' })),
  createLeadInvoiceItem: jest.fn(async () => ({ id: 'ii_test' })),
  finalizeAndPayInvoice: jest.fn(async () => ({ id: 'in_test', status: 'paid' })),
  getSessionCard: jest.fn(),
  retrieveSubscription: jest.fn(),
  cancelSubscription: jest.fn(async () => ({})),
  constructWebhookEvent: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/app');
const stripe = require('../src/services/stripe');
const { runMonthlyBilling } = require('../src/services/billing');
const { db, resetDb, createBusiness, createClient, createAdmin } = require('./helpers');

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
});
afterAll(async () => { await db.$disconnect(); });

// Create N unbilled leads for a business (each needs its own conversation).
async function seedLeads(business, count) {
  const leads = [];
  for (let i = 0; i < count; i += 1) {
    const { user: client } = await createClient({ email: `lead_${Date.now()}_${i}_${Math.random()}@test.com` });
    const conversation = await db.conversation.create({
      data: { clientId: client.id, businessId: business.id },
    });
    leads.push(await db.lead.create({
      data: { conversationId: conversation.id, businessId: business.id },
    }));
  }
  return leads;
}

describe('runMonthlyBilling (service)', () => {
  test('invoices a business with a saved customer and marks its leads billed', async () => {
    const { business } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { stripeCustomerId: 'cus_test' } });
    await seedLeads(business, 3);

    const result = await runMonthlyBilling();

    expect(result.businessesBilled).toBe(1);
    expect(result.leadsBilled).toBe(3);
    // One invoice item per lead, one finalized invoice for the business.
    expect(stripe.createLeadInvoiceItem).toHaveBeenCalledTimes(3);
    expect(stripe.finalizeAndPayInvoice).toHaveBeenCalledTimes(1);

    const remaining = await db.lead.count({ where: { businessId: business.id, billed: false } });
    expect(remaining).toBe(0);
    const billed = await db.lead.findMany({ where: { businessId: business.id } });
    expect(billed.every((l) => l.billed && l.billedAt)).toBe(true);
  });

  test('skips a business with no payment method and leaves its leads unbilled', async () => {
    const { business } = await createBusiness();
    await seedLeads(business, 2);

    const result = await runMonthlyBilling();

    expect(result.businessesBilled).toBe(0);
    expect(result.skipped).toEqual([
      expect.objectContaining({ businessId: business.id, leadCount: 2, reason: 'no-payment-method' }),
    ]);
    expect(stripe.finalizeAndPayInvoice).not.toHaveBeenCalled();
    const remaining = await db.lead.count({ where: { businessId: business.id, billed: false } });
    expect(remaining).toBe(2);
  });

  test('is idempotent — a second run bills nothing', async () => {
    const { business } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { stripeCustomerId: 'cus_test' } });
    await seedLeads(business, 2);

    await runMonthlyBilling();
    jest.clearAllMocks();
    const second = await runMonthlyBilling();

    expect(second.leadsBilled).toBe(0);
    expect(stripe.finalizeAndPayInvoice).not.toHaveBeenCalled();
  });

  test('a failed charge leaves the leads unbilled for retry', async () => {
    const { business } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { stripeCustomerId: 'cus_test' } });
    await seedLeads(business, 2);
    stripe.finalizeAndPayInvoice.mockRejectedValueOnce(new Error('card_declined'));

    const result = await runMonthlyBilling();

    expect(result.businessesBilled).toBe(0);
    expect(result.skipped[0]).toEqual(
      expect.objectContaining({ businessId: business.id, reason: 'charge-failed' }),
    );
    const remaining = await db.lead.count({ where: { businessId: business.id, billed: false } });
    expect(remaining).toBe(2);
  });

  test('only bills the businesses that have unbilled leads', async () => {
    const a = await createBusiness({ email: 'a@biz.com' });
    const b = await createBusiness({ email: 'b@biz.com' });
    await db.business.update({ where: { id: a.business.id }, data: { stripeCustomerId: 'cus_a' } });
    await db.business.update({ where: { id: b.business.id }, data: { stripeCustomerId: 'cus_b' } });
    await seedLeads(a.business, 1);

    const result = await runMonthlyBilling();
    expect(result.businessesBilled).toBe(1);
    expect(result.invoices[0].businessId).toBe(a.business.id);
  });
});

describe('Billing routes', () => {
  test('POST /billing/setup-card returns a hosted Checkout url and stores the customer', async () => {
    const { token, business } = await createBusiness();
    const res = await request(app).post('/billing/setup-card')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/checkout\.stripe\.com/);
    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.stripeCustomerId).toBe('cus_test');
  });

  test('setup-card reuses an existing Stripe customer', async () => {
    const { token, business } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { stripeCustomerId: 'cus_existing' } });

    const res = await request(app).post('/billing/setup-card')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(stripe.createOrRetrieveCustomer).not.toHaveBeenCalled();
    expect(stripe.createSetupCheckoutSession).toHaveBeenCalledWith('cus_existing');
  });

  test('setup-card requires a business account', async () => {
    const { token } = await createClient();
    await request(app).post('/billing/setup-card')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  test('GET /billing/summary reports accrued lead fees and card state', async () => {
    const { token, business } = await createBusiness();
    await db.business.update({
      where: { id: business.id },
      data: { cardBrand: 'visa', cardLast4: '4242' },
    });
    await seedLeads(business, 4);

    const res = await request(app).get('/billing/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasPaymentMethod).toBe(true);
    expect(res.body.card).toEqual({ brand: 'visa', last4: '4242' });
    expect(res.body.unbilledLeads).toBe(4);
    expect(res.body.unbilledAmountCents).toBe(4 * 2500);
  });

  test('summary shows no card when none is saved', async () => {
    const { token } = await createBusiness();
    const res = await request(app).get('/billing/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.hasPaymentMethod).toBe(false);
    expect(res.body.card).toBeNull();
    expect(res.body.unbilledLeads).toBe(0);
  });

  test('POST /billing/run-monthly is admin-only', async () => {
    const { token: bizToken } = await createBusiness();
    await request(app).post('/billing/run-monthly')
      .set('Authorization', `Bearer ${bizToken}`)
      .expect(403);

    const { token: adminToken } = await createAdmin();
    const res = await request(app).post('/billing/run-monthly')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('leadsBilled');
  });
});

describe('Advertising subscribe (hosted Checkout)', () => {
  test('POST /advertising/subscribe returns a hosted Checkout url', async () => {
    const { token, business } = await createBusiness();
    const res = await request(app).post('/advertising/subscribe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/checkout\.stripe\.com/);
    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.stripeCustomerId).toBe('cus_test');
  });

  test('subscribe rejects an already-promoted business', async () => {
    const { token, business } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { isPromoted: true } });
    await request(app).post('/advertising/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });
});
