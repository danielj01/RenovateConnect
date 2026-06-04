// Mock only the Stripe SDK-calling functions; keep the real deposit/commission
// math (depositCentsFor / commissionCentsFor) so the route's amounts are
// exercised for real.
jest.mock('../src/services/stripe', () => {
  const actual = jest.requireActual('../src/services/stripe');
  return {
    ...actual,
    createConnectAccount: jest.fn(),
    createAccountOnboardingLink: jest.fn(),
    retrieveAccount: jest.fn(),
    createDepositPaymentIntent: jest.fn(),
  };
});

const request = require('supertest');
const app = require('../src/app');
const stripe = require('../src/services/stripe');
const { db, resetDb, createClient, createBusiness } = require('./helpers');

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
  process.env.DEPOSIT_PERCENT = '10';
  process.env.DEPOSIT_MIN_CENTS = '5000';
  process.env.COMMISSION_BPS = '800';
});
afterAll(async () => { await db.$disconnect(); });

// Create an ACCEPTED quote from `client` to `business` with a known price range.
async function acceptedQuote(clientId, businessId, quoteLow = 4000, quoteHigh = 6000) {
  return db.quoteRequest.create({
    data: {
      clientId, businessId,
      description: 'Kitchen remodel',
      status: 'ACCEPTED',
      quoteLow, quoteHigh, respondedAt: new Date(),
    },
  });
}

describe('POST /payments/connect/onboard', () => {
  test('requires a BUSINESS role', async () => {
    const { token } = await createClient();
    const res = await request(app).post('/payments/connect/onboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('creates a connected account + returns an onboarding url', async () => {
    const { business, token } = await createBusiness();
    stripe.createConnectAccount.mockResolvedValueOnce({ id: 'acct_new' });
    stripe.createAccountOnboardingLink.mockResolvedValueOnce({ url: 'https://connect.stripe/onboard' });

    const res = await request(app).post('/payments/connect/onboard').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://connect.stripe/onboard');
    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.stripeAccountId).toBe('acct_new');
  });

  test('reuses an existing connected account', async () => {
    const { business, token } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { stripeAccountId: 'acct_existing' } });
    stripe.createAccountOnboardingLink.mockResolvedValueOnce({ url: 'https://connect.stripe/again' });

    const res = await request(app).post('/payments/connect/onboard').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(stripe.createConnectAccount).not.toHaveBeenCalled();
    expect(stripe.createAccountOnboardingLink).toHaveBeenCalledWith('acct_existing');
  });
});

describe('GET /payments/connect/status', () => {
  test('syncs capability flags from Stripe', async () => {
    const { business, token } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { stripeAccountId: 'acct_s' } });
    stripe.retrieveAccount.mockResolvedValueOnce({ charges_enabled: true, payouts_enabled: true });

    const res = await request(app).get('/payments/connect/status').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ onboarded: true, chargesEnabled: true, payoutsEnabled: true });
    const updated = await db.business.findUnique({ where: { id: business.id } });
    expect(updated.payoutsEnabled).toBe(true);
  });

  test('reports not-onboarded when no account exists', async () => {
    const { token } = await createBusiness();
    const res = await request(app).get('/payments/connect/status').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.onboarded).toBe(false);
    expect(stripe.retrieveAccount).not.toHaveBeenCalled();
  });
});

describe('POST /payments/deposit', () => {
  async function payoutReadyBusiness() {
    const made = await createBusiness();
    await db.business.update({
      where: { id: made.business.id },
      data: { stripeAccountId: 'acct_ready', payoutsEnabled: true, chargesEnabled: true },
    });
    return made;
  }

  test('creates a PENDING Payment and returns the client secret + amounts', async () => {
    const { user: client, token } = await createClient();
    const { business } = await payoutReadyBusiness();
    const quote = await acceptedQuote(client.id, business.id, 4000, 6000);
    stripe.createDepositPaymentIntent.mockResolvedValueOnce({ id: 'pi_1', client_secret: 'pi_1_secret' });

    const res = await request(app).post('/payments/deposit')
      .set('Authorization', `Bearer ${token}`)
      .send({ quoteRequestId: quote.id });

    expect(res.status).toBe(201);
    // deposit = 10% of $5000 midpoint = 50000c; commission 8% = 4000c; total 54000c
    expect(res.body).toMatchObject({
      clientSecret: 'pi_1_secret', depositCents: 50000, commissionCents: 4000, amountCents: 54000,
    });
    // Destination charge: fee on top, routed to the contractor's account.
    expect(stripe.createDepositPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({
      amountCents: 54000, commissionCents: 4000, connectedAccountId: 'acct_ready',
    }));
    const payment = await db.payment.findUnique({ where: { quoteRequestId: quote.id } });
    expect(payment.status).toBe('PENDING');
    expect(payment.stripePaymentIntentId).toBe('pi_1');
  });

  test('rejects a quote that is not ACCEPTED', async () => {
    const { user: client, token } = await createClient();
    const { business } = await payoutReadyBusiness();
    const quote = await db.quoteRequest.create({
      data: { clientId: client.id, businessId: business.id, description: 'x', status: 'QUOTED', quoteLow: 100, quoteHigh: 200 },
    });
    const res = await request(app).post('/payments/deposit')
      .set('Authorization', `Bearer ${token}`).send({ quoteRequestId: quote.id });
    expect(res.status).toBe(409);
  });

  test('rejects when the contractor has not enabled payouts', async () => {
    const { user: client, token } = await createClient();
    const { business } = await createBusiness(); // no payouts
    const quote = await acceptedQuote(client.id, business.id);
    const res = await request(app).post('/payments/deposit')
      .set('Authorization', `Bearer ${token}`).send({ quoteRequestId: quote.id });
    expect(res.status).toBe(409);
    expect(stripe.createDepositPaymentIntent).not.toHaveBeenCalled();
  });

  test('forbids paying another homeowner\'s quote', async () => {
    const { user: owner } = await createClient();
    const { token: otherToken } = await createClient();
    const { business } = await payoutReadyBusiness();
    const quote = await acceptedQuote(owner.id, business.id);
    const res = await request(app).post('/payments/deposit')
      .set('Authorization', `Bearer ${otherToken}`).send({ quoteRequestId: quote.id });
    expect(res.status).toBe(403);
  });

  test('refuses to re-create a deposit that already succeeded', async () => {
    const { user: client, token } = await createClient();
    const { business } = await payoutReadyBusiness();
    const quote = await acceptedQuote(client.id, business.id);
    await db.payment.create({
      data: { clientId: client.id, businessId: business.id, quoteRequestId: quote.id, amountCents: 54000, commissionCents: 4000, status: 'SUCCEEDED' },
    });
    const res = await request(app).post('/payments/deposit')
      .set('Authorization', `Bearer ${token}`).send({ quoteRequestId: quote.id });
    expect(res.status).toBe(409);
  });

  test('retries a PENDING deposit by refreshing the intent in place', async () => {
    const { user: client, token } = await createClient();
    const { business } = await payoutReadyBusiness();
    const quote = await acceptedQuote(client.id, business.id);
    const stale = await db.payment.create({
      data: { clientId: client.id, businessId: business.id, quoteRequestId: quote.id, amountCents: 54000, commissionCents: 4000, status: 'PENDING', stripePaymentIntentId: 'pi_old' },
    });
    stripe.createDepositPaymentIntent.mockResolvedValueOnce({ id: 'pi_new', client_secret: 'pi_new_secret' });

    const res = await request(app).post('/payments/deposit')
      .set('Authorization', `Bearer ${token}`).send({ quoteRequestId: quote.id });

    expect(res.status).toBe(201);
    expect(res.body.clientSecret).toBe('pi_new_secret');
    const rows = await db.payment.findMany({ where: { quoteRequestId: quote.id } });
    expect(rows).toHaveLength(1); // refreshed, not duplicated
    expect(rows[0].id).toBe(stale.id);
    expect(rows[0].stripePaymentIntentId).toBe('pi_new');
  });
});

describe('GET /payments', () => {
  test('returns only the caller\'s payments (client) / business payments (owner)', async () => {
    const { user: client, token: clientToken } = await createClient();
    const { user: other } = await createClient();
    const { business, token: bizToken } = await createBusiness();
    await db.payment.create({ data: { clientId: client.id, businessId: business.id, amountCents: 1000, commissionCents: 80, status: 'SUCCEEDED' } });
    await db.payment.create({ data: { clientId: other.id, businessId: business.id, amountCents: 2000, commissionCents: 160, status: 'SUCCEEDED' } });

    const asClient = await request(app).get('/payments').set('Authorization', `Bearer ${clientToken}`);
    expect(asClient.status).toBe(200);
    expect(asClient.body).toHaveLength(1);
    expect(asClient.body[0].clientId).toBe(client.id);

    const asBiz = await request(app).get('/payments').set('Authorization', `Bearer ${bizToken}`);
    expect(asBiz.body).toHaveLength(2); // both belong to this business
  });
});
