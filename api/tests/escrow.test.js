// Milestone escrow: project setup, milestone funding (held on platform),
// contractor proof submission, homeowner release (transfer), refund, and the
// auto-release sweep. Stripe SDK calls are mocked; commission math is real.
jest.mock('../src/services/stripe', () => {
  const actual = jest.requireActual('../src/services/stripe');
  return {
    ...actual,
    createMilestoneCheckoutSession: jest.fn(),
    createMilestoneTransfer: jest.fn(),
    createMilestoneRefund: jest.fn(),
  };
});

const request = require('supertest');
const app = require('../src/app');
const stripe = require('../src/services/stripe');
const { handleStripeEvent } = require('../src/routes/webhooks');
const { autoReleaseStaleMilestones } = require('../src/routes/projects');
const { db, resetDb, createClient, createBusiness } = require('./helpers');

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
  process.env.COMMISSION_BPS = '800';
  process.env.MILESTONE_AUTO_RELEASE_DAYS = '7';
});
afterAll(async () => { await db.$disconnect(); });

// A business that can receive in-app payouts.
async function payoutBusiness() {
  const made = await createBusiness();
  const business = await db.business.update({
    where: { id: made.business.id },
    data: { stripeAccountId: 'acct_pay', payoutsEnabled: true },
  });
  return { ...made, business };
}

async function acceptedQuote(clientId, businessId) {
  return db.quoteRequest.create({
    data: {
      clientId, businessId, description: 'Kitchen remodel', category: 'Kitchen',
      status: 'ACCEPTED', quoteLow: 10000, quoteHigh: 20000, respondedAt: new Date(),
    },
  });
}

describe('POST /projects (create from accepted quote)', () => {
  test('creates a project, idempotent on the pair', async () => {
    const { user: client, token } = await createClient();
    const { business } = await payoutBusiness();
    const quote = await acceptedQuote(client.id, business.id);

    const first = await request(app).post('/projects')
      .set('Authorization', `Bearer ${token}`).send({ quoteRequestId: quote.id });
    expect(first.status).toBe(201);
    expect(first.body.title).toBe('Kitchen project');

    const second = await request(app).post('/projects')
      .set('Authorization', `Bearer ${token}`).send({ quoteRequestId: quote.id });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
  });

  test('rejects a project from a non-accepted quote', async () => {
    const { user: client, token } = await createClient();
    const { business } = await payoutBusiness();
    const quote = await db.quoteRequest.create({
      data: { clientId: client.id, businessId: business.id, description: 'x', status: 'PENDING' },
    });
    const res = await request(app).post('/projects')
      .set('Authorization', `Bearer ${token}`).send({ quoteRequestId: quote.id });
    expect(res.status).toBe(409);
  });
});

describe('milestone lifecycle', () => {
  async function setupProject() {
    const { user: client, token: clientToken } = await createClient();
    const owner = await payoutBusiness();
    const quote = await acceptedQuote(client.id, owner.business.id);
    const project = await db.project.create({
      data: { clientId: client.id, businessId: owner.business.id, quoteRequestId: quote.id, title: 'Kitchen project' },
    });
    return { client, clientToken, owner, project };
  }

  test('contractor adds a milestone; client cannot', async () => {
    const { clientToken, owner, project } = await setupProject();

    const asClient = await request(app).post(`/projects/${project.id}/milestones`)
      .set('Authorization', `Bearer ${clientToken}`).send({ title: 'Demo', amountCents: 500000 });
    expect(asClient.status).toBe(403);

    const asOwner = await request(app).post(`/projects/${project.id}/milestones`)
      .set('Authorization', `Bearer ${owner.token}`).send({ title: 'Demo', amountCents: 500000 });
    expect(asOwner.status).toBe(201);
    expect(asOwner.body.status).toBe('PENDING');
  });

  test('fund → webhook FUNDED → submit → approve releases the transfer', async () => {
    const { client, clientToken, owner, project } = await setupProject();
    const milestone = await db.milestone.create({
      data: { projectId: project.id, title: 'Cabinets', amountCents: 500000 },
    });

    // Fund: returns a checkout URL and creates a PENDING payment (fee on top).
    stripe.createMilestoneCheckoutSession.mockResolvedValueOnce({ url: 'https://checkout/milestone' });
    const fund = await request(app).post(`/projects/${project.id}/milestones/${milestone.id}/fund`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(fund.status).toBe(201);
    expect(fund.body.url).toBe('https://checkout/milestone');
    expect(fund.body.amountCents).toBe(500000);
    expect(fund.body.commissionCents).toBe(40000); // 8%
    expect(fund.body.totalCents).toBe(540000);

    const payment = await db.payment.findUnique({ where: { milestoneId: milestone.id } });
    expect(payment.status).toBe('PENDING');

    // Webhook settles the held charge → milestone FUNDED.
    await handleStripeEvent({
      type: 'checkout.session.completed',
      data: { object: { mode: 'payment', payment_intent: 'pi_ms', metadata: { paymentId: payment.id, milestoneId: milestone.id } } },
    });
    let m = await db.milestone.findUnique({ where: { id: milestone.id } });
    expect(m.status).toBe('FUNDED');
    expect((await db.payment.findUnique({ where: { id: payment.id } })).status).toBe('SUCCEEDED');

    // Funding notifies the contractor that money is in escrow.
    const fundedActivity = await db.activity.findFirst({
      where: { userId: owner.user.id, type: 'PAYMENT', title: 'Milestone funded' },
    });
    expect(fundedActivity).not.toBeNull();
    expect(fundedActivity.body).toContain('Cabinets');

    // Contractor submits work (no photos in test) → SUBMITTED.
    const submit = await request(app).post(`/projects/${project.id}/milestones/${milestone.id}/submit`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(submit.status).toBe(200);
    expect(submit.body.status).toBe('SUBMITTED');

    // Homeowner approves → transfer to contractor, APPROVED.
    stripe.createMilestoneTransfer.mockResolvedValueOnce({ id: 'tr_ms' });
    const approve = await request(app).post(`/projects/${project.id}/milestones/${milestone.id}/approve`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('APPROVED');
    expect(stripe.createMilestoneTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 500000, connectedAccountId: 'acct_pay' }),
    );
    m = await db.milestone.findUnique({ where: { id: milestone.id } });
    expect(m.stripeTransferId).toBe('tr_ms');
    expect(client).toBeTruthy();
  });

  test('a replayed funded webhook does not re-notify the contractor', async () => {
    const { client, owner, project } = await setupProject();
    // Already FUNDED — a duplicate/late checkout event must be a silent no-op.
    const milestone = await db.milestone.create({
      data: { projectId: project.id, title: 'Cabinets', amountCents: 500000, status: 'FUNDED', fundedAt: new Date() },
    });
    const payment = await db.payment.create({
      data: {
        clientId: client.id, businessId: owner.business.id, milestoneId: milestone.id,
        amountCents: 540000, commissionCents: 40000, status: 'SUCCEEDED',
      },
    });

    await handleStripeEvent({
      type: 'checkout.session.completed',
      data: { object: { mode: 'payment', metadata: { paymentId: payment.id, milestoneId: milestone.id } } },
    });

    const count = await db.activity.count({
      where: { userId: owner.user.id, title: 'Milestone funded' },
    });
    expect(count).toBe(0);
  });

  test('cannot fund an already-funded milestone', async () => {
    const { clientToken, project } = await setupProject();
    const milestone = await db.milestone.create({
      data: { projectId: project.id, title: 'Cabinets', amountCents: 500000, status: 'FUNDED', fundedAt: new Date() },
    });
    const res = await request(app).post(`/projects/${project.id}/milestones/${milestone.id}/fund`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(409);
  });

  test('cannot approve a milestone that is not awaiting release', async () => {
    const { clientToken, project } = await setupProject();
    const milestone = await db.milestone.create({
      data: { projectId: project.id, title: 'Cabinets', amountCents: 500000, status: 'PENDING' },
    });
    const res = await request(app).post(`/projects/${project.id}/milestones/${milestone.id}/approve`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(409);
  });
});

describe('auto-release sweep', () => {
  test('releases milestones submitted past the grace window, leaves fresh ones', async () => {
    const { user: client } = await createClient();
    const owner = await payoutBusiness();
    const project = await db.project.create({
      data: { clientId: client.id, businessId: owner.business.id, title: 'Kitchen project' },
    });

    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const stale = await db.milestone.create({
      data: { projectId: project.id, title: 'Old', amountCents: 300000, status: 'SUBMITTED', submittedAt: eightDaysAgo },
    });
    const fresh = await db.milestone.create({
      data: { projectId: project.id, title: 'New', amountCents: 300000, status: 'SUBMITTED', submittedAt: new Date() },
    });

    stripe.createMilestoneTransfer.mockResolvedValue({ id: 'tr_auto' });
    const released = await autoReleaseStaleMilestones();
    expect(released).toBe(1);

    expect((await db.milestone.findUnique({ where: { id: stale.id } })).status).toBe('APPROVED');
    expect((await db.milestone.findUnique({ where: { id: fresh.id } })).status).toBe('SUBMITTED');

    // Contractor is told funds went out (via releaseMilestone) and the homeowner
    // is told it auto-released (they never tapped approve). notifyPayment stores
    // the emoji title verbatim in the feed.
    expect(await db.activity.findFirst({
      where: { userId: owner.user.id, type: 'PAYMENT', title: 'Milestone released 💰' },
    })).not.toBeNull();
    expect(await db.activity.findFirst({
      where: { userId: client.id, type: 'PAYMENT', title: 'Milestone auto-released ⏱️' },
    })).not.toBeNull();
  });
});

describe('review prompt after release', () => {
  const PROMPT_TITLE = 'How did it go? ⭐';

  async function fundedMilestone() {
    const { user: client, token: clientToken } = await createClient();
    const owner = await payoutBusiness();
    const project = await db.project.create({
      data: { clientId: client.id, businessId: owner.business.id, title: 'Kitchen project' },
    });
    const milestone = await db.milestone.create({
      data: { projectId: project.id, title: 'Cabinets', amountCents: 500000, status: 'FUNDED', fundedAt: new Date() },
    });
    return { client, clientToken, owner, project, milestone };
  }

  test('approving a release nudges the homeowner to review the contractor', async () => {
    const { client, clientToken, owner, project, milestone } = await fundedMilestone();

    stripe.createMilestoneTransfer.mockResolvedValueOnce({ id: 'tr_review' });
    const res = await request(app).post(`/projects/${project.id}/milestones/${milestone.id}/approve`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(200);

    const prompt = await db.activity.findFirst({
      where: { userId: client.id, type: 'REVIEW', title: PROMPT_TITLE },
    });
    expect(prompt).not.toBeNull();
    expect(prompt.data.businessId).toBe(owner.business.id);
    expect(prompt.data.projectId).toBe(project.id);
    expect(prompt.body).toContain('Test Co');
  });

  test('a second milestone release does not re-prompt the same homeowner', async () => {
    const { client, clientToken, project, milestone } = await fundedMilestone();
    const second = await db.milestone.create({
      data: { projectId: project.id, title: 'Counters', amountCents: 200000, status: 'FUNDED', fundedAt: new Date() },
    });

    stripe.createMilestoneTransfer.mockResolvedValue({ id: 'tr_x' });
    await request(app).post(`/projects/${project.id}/milestones/${milestone.id}/approve`)
      .set('Authorization', `Bearer ${clientToken}`);
    await request(app).post(`/projects/${project.id}/milestones/${second.id}/approve`)
      .set('Authorization', `Bearer ${clientToken}`);

    const count = await db.activity.count({
      where: { userId: client.id, type: 'REVIEW', title: PROMPT_TITLE },
    });
    expect(count).toBe(1);
  });

  test('no nudge if the homeowner already reviewed this contractor', async () => {
    const { client, clientToken, owner, project, milestone } = await fundedMilestone();
    await db.review.create({
      data: { businessId: owner.business.id, authorId: client.id, authorName: 'Test Client', rating: 5 },
    });

    stripe.createMilestoneTransfer.mockResolvedValueOnce({ id: 'tr_y' });
    await request(app).post(`/projects/${project.id}/milestones/${milestone.id}/approve`)
      .set('Authorization', `Bearer ${clientToken}`);

    const count = await db.activity.count({
      where: { userId: client.id, type: 'REVIEW', title: PROMPT_TITLE },
    });
    expect(count).toBe(0);
  });

  test('auto-release also nudges the homeowner to review', async () => {
    const { user: client } = await createClient();
    const owner = await payoutBusiness();
    const project = await db.project.create({
      data: { clientId: client.id, businessId: owner.business.id, title: 'Kitchen project' },
    });
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db.milestone.create({
      data: { projectId: project.id, title: 'Old', amountCents: 300000, status: 'SUBMITTED', submittedAt: eightDaysAgo },
    });

    stripe.createMilestoneTransfer.mockResolvedValue({ id: 'tr_auto' });
    await autoReleaseStaleMilestones();

    const prompt = await db.activity.findFirst({
      where: { userId: client.id, type: 'REVIEW', title: PROMPT_TITLE },
    });
    expect(prompt).not.toBeNull();
    expect(prompt.data.businessId).toBe(owner.business.id);
  });
});

describe('refund a funded milestone', () => {
  test('contractor refunds; charge.refunded webhook flips milestone to REFUNDED', async () => {
    const { user: client } = await createClient();
    const owner = await payoutBusiness();
    const project = await db.project.create({
      data: { clientId: client.id, businessId: owner.business.id, title: 'Kitchen project' },
    });
    const milestone = await db.milestone.create({
      data: { projectId: project.id, title: 'Cabinets', amountCents: 500000, status: 'FUNDED', fundedAt: new Date() },
    });
    await db.payment.create({
      data: {
        clientId: client.id, businessId: owner.business.id, milestoneId: milestone.id,
        amountCents: 540000, commissionCents: 40000, status: 'SUCCEEDED',
        stripePaymentIntentId: 'pi_ref', paidAt: new Date(),
      },
    });

    stripe.createMilestoneRefund.mockResolvedValueOnce({ id: 're_ms' });
    const res = await request(app).post(`/projects/${project.id}/milestones/${milestone.id}/refund`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(stripe.createMilestoneRefund).toHaveBeenCalledWith('pi_ref');

    await handleStripeEvent({
      type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_ref' } },
    });
    expect((await db.milestone.findUnique({ where: { id: milestone.id } })).status).toBe('REFUNDED');

    // The homeowner is told, with milestone-specific wording (not "deposit").
    const refundActivity = await db.activity.findFirst({
      where: { userId: client.id, type: 'PAYMENT', title: 'Milestone refunded' },
    });
    expect(refundActivity).not.toBeNull();
    expect(refundActivity.body).toContain('milestone payment');
  });
});
