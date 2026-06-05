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
    createDepositCheckoutSession: jest.fn(),
    createRefund: jest.fn(),
  };
});

const request = require('supertest');
const app = require('../src/app');
const stripe = require('../src/services/stripe');
const { db, resetDb, createClient, createBusiness, createAdmin } = require('./helpers');

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

  test('creates a PENDING Payment and returns the hosted checkout url + amounts', async () => {
    const { user: client, token } = await createClient();
    const { business } = await payoutReadyBusiness();
    const quote = await acceptedQuote(client.id, business.id, 4000, 6000);
    stripe.createDepositCheckoutSession.mockResolvedValueOnce({ id: 'cs_1', url: 'https://checkout.stripe/deposit' });

    const res = await request(app).post('/payments/deposit')
      .set('Authorization', `Bearer ${token}`)
      .send({ quoteRequestId: quote.id });

    expect(res.status).toBe(201);
    // deposit = 10% of $5000 midpoint = 50000c; commission 8% = 4000c; total 54000c
    expect(res.body).toMatchObject({
      url: 'https://checkout.stripe/deposit', depositCents: 50000, commissionCents: 4000, amountCents: 54000,
    });
    // Destination charge: fee on top, routed to the contractor's account, with
    // the Payment row id carried as metadata for the webhook to settle.
    expect(stripe.createDepositCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      amountCents: 54000, commissionCents: 4000, connectedAccountId: 'acct_ready',
      metadata: expect.objectContaining({ paymentId: res.body.paymentId }),
    }));
    const payment = await db.payment.findUnique({ where: { quoteRequestId: quote.id } });
    expect(payment.status).toBe('PENDING');
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
    expect(stripe.createDepositCheckoutSession).not.toHaveBeenCalled();
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

  test('retries a PENDING deposit by refreshing the checkout in place', async () => {
    const { user: client, token } = await createClient();
    const { business } = await payoutReadyBusiness();
    const quote = await acceptedQuote(client.id, business.id);
    const stale = await db.payment.create({
      data: { clientId: client.id, businessId: business.id, quoteRequestId: quote.id, amountCents: 54000, commissionCents: 4000, status: 'PENDING' },
    });
    stripe.createDepositCheckoutSession.mockResolvedValueOnce({ id: 'cs_new', url: 'https://checkout.stripe/again' });

    const res = await request(app).post('/payments/deposit')
      .set('Authorization', `Bearer ${token}`).send({ quoteRequestId: quote.id });

    expect(res.status).toBe(201);
    expect(res.body.url).toBe('https://checkout.stripe/again');
    const rows = await db.payment.findMany({ where: { quoteRequestId: quote.id } });
    expect(rows).toHaveLength(1); // refreshed, not duplicated
    expect(rows[0].id).toBe(stale.id);
  });
});

describe('POST /payments/:id/refund', () => {
  // A SUCCEEDED deposit from `client` to `business`, with a Stripe charge on file.
  async function settledDeposit(clientId, businessId, overrides = {}) {
    return db.payment.create({
      data: {
        clientId, businessId,
        amountCents: 54000, commissionCents: 4000,
        status: 'SUCCEEDED',
        stripePaymentIntentId: 'pi_settled',
        paidAt: new Date(),
        ...overrides,
      },
    });
  }

  test('the owning contractor can issue a full refund (reversing the transfer + fee)', async () => {
    const { user: client } = await createClient();
    const { business, token } = await createBusiness();
    const payment = await settledDeposit(client.id, business.id);
    stripe.createRefund.mockResolvedValueOnce({ id: 're_1' });

    const res = await request(app).post(`/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(stripe.createRefund).toHaveBeenCalledWith('pi_settled');
  });

  test('an admin can refund any deposit', async () => {
    const { user: client } = await createClient();
    const { business } = await createBusiness();
    const { token } = await createAdmin();
    const payment = await settledDeposit(client.id, business.id);
    stripe.createRefund.mockResolvedValueOnce({ id: 're_2' });

    const res = await request(app).post(`/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('the paying homeowner cannot refund their own deposit', async () => {
    const { user: client, token } = await createClient();
    const { business } = await createBusiness();
    const payment = await settledDeposit(client.id, business.id);

    const res = await request(app).post(`/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(stripe.createRefund).not.toHaveBeenCalled();
  });

  test('a different contractor cannot refund someone else\'s deposit', async () => {
    const { user: client } = await createClient();
    const { business } = await createBusiness();
    const { token: otherToken } = await createBusiness();
    const payment = await settledDeposit(client.id, business.id);

    const res = await request(app).post(`/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
    expect(stripe.createRefund).not.toHaveBeenCalled();
  });

  test('refunding requires authentication', async () => {
    const { user: client } = await createClient();
    const { business } = await createBusiness();
    const payment = await settledDeposit(client.id, business.id);
    await request(app).post(`/payments/${payment.id}/refund`).expect(401);
  });

  test('a non-existent payment returns 404', async () => {
    const { token } = await createAdmin();
    await request(app).post('/payments/nope/refund')
      .set('Authorization', `Bearer ${token}`).expect(404);
  });

  test('only a SUCCEEDED deposit can be refunded', async () => {
    const { user: client } = await createClient();
    const { business, token } = await createBusiness();
    const payment = await settledDeposit(client.id, business.id, { status: 'PENDING' });

    const res = await request(app).post(`/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(stripe.createRefund).not.toHaveBeenCalled();
  });

  test('a deposit with no Stripe charge cannot be refunded', async () => {
    const { user: client } = await createClient();
    const { business, token } = await createBusiness();
    const payment = await settledDeposit(client.id, business.id, { stripePaymentIntentId: null });

    const res = await request(app).post(`/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(stripe.createRefund).not.toHaveBeenCalled();
  });
});

describe('GET /payments/earnings', () => {
  test('summarizes released, escrowed, fees and refunds for the contractor', async () => {
    const { user: client } = await createClient();
    const { business, token: bizToken } = await createBusiness();

    // A settled deposit: net to the contractor is amount − commission.
    await db.payment.create({ data: { clientId: client.id, businessId: business.id, amountCents: 100000, commissionCents: 8000, status: 'SUCCEEDED' } });
    // A refunded deposit: excluded from released, counted as refunded.
    await db.payment.create({ data: { clientId: client.id, businessId: business.id, amountCents: 50000, commissionCents: 4000, status: 'REFUNDED', refundedAt: new Date() } });

    const project = await db.project.create({
      data: { clientId: client.id, businessId: business.id, title: 'Kitchen project' },
    });
    const approved = await db.milestone.create({ data: { projectId: project.id, title: 'Demo', amountCents: 300000, status: 'APPROVED', approvedAt: new Date() } });
    await db.milestone.create({ data: { projectId: project.id, title: 'Cabinets', amountCents: 200000, status: 'FUNDED', fundedAt: new Date() } });
    await db.milestone.create({ data: { projectId: project.id, title: 'Counters', amountCents: 100000, status: 'SUBMITTED', submittedAt: new Date() } });
    await db.milestone.create({ data: { projectId: project.id, title: 'Paint', amountCents: 50000, status: 'PENDING' } });
    // A settled milestone-funding payment contributes its commission to fees.
    await db.payment.create({ data: { clientId: client.id, businessId: business.id, milestoneId: approved.id, amountCents: 324000, commissionCents: 24000, status: 'SUCCEEDED' } });

    const res = await request(app).get('/payments/earnings').set('Authorization', `Bearer ${bizToken}`);
    expect(res.status).toBe(200);
    expect(res.body.releasedCents).toBe(392000); // 92000 deposit net + 300000 approved milestone
    expect(res.body.inEscrowCents).toBe(300000); // FUNDED 200000 + SUBMITTED 100000
    expect(res.body.inEscrowCount).toBe(2);
    expect(res.body.releasedCount).toBe(2); // 1 settled deposit + 1 approved milestone
    expect(res.body.lifetimeFeesCents).toBe(32000); // 8000 deposit + 24000 milestone funding
    expect(res.body.refundedCents).toBe(50000);
  });

  test('a homeowner cannot read contractor earnings', async () => {
    const { token: clientToken } = await createClient();
    const res = await request(app).get('/payments/earnings').set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(403);
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
