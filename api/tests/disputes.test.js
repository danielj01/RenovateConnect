// Milestone disputes: homeowner can pause auto-release with a reason + details,
// withdraw their own dispute, and admin resolves with RELEASE or REFUND.
jest.mock('../src/services/stripe', () => {
  const actual = jest.requireActual('../src/services/stripe');
  return {
    ...actual,
    createMilestoneTransfer: jest.fn(),
    createMilestoneRefund: jest.fn(),
  };
});

const request = require('supertest');
const app = require('../src/app');
const stripe = require('../src/services/stripe');
const { autoReleaseStaleMilestones } = require('../src/routes/projects');
const { db, resetDb, createClient, createBusiness, createAdmin } = require('./helpers');

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
  process.env.MILESTONE_AUTO_RELEASE_DAYS = '7';
});
afterAll(async () => { await db.$disconnect(); });

async function setupSubmittedMilestone({ status = 'SUBMITTED' } = {}) {
  const { user: client, token: clientToken } = await createClient();
  const made = await createBusiness();
  const business = await db.business.update({
    where: { id: made.business.id },
    data: { stripeAccountId: 'acct_pay', payoutsEnabled: true },
  });
  const quote = await db.quoteRequest.create({
    data: { clientId: client.id, businessId: business.id,
            description: 'Bath', status: 'ACCEPTED', respondedAt: new Date() },
  });
  const project = await db.project.create({
    data: { clientId: client.id, businessId: business.id,
            quoteRequestId: quote.id, title: 'Bath project' },
  });
  const milestone = await db.milestone.create({
    data: { projectId: project.id, title: 'Tile', amountCents: 500000,
            status, fundedAt: new Date(),
            submittedAt: status === 'SUBMITTED' ? new Date() : null },
  });
  const payment = await db.payment.create({
    data: { clientId: client.id, businessId: business.id, milestoneId: milestone.id,
            amountCents: 540000, commissionCents: 40000, status: 'SUCCEEDED',
            stripePaymentIntentId: 'pi_test' },
  });
  return { client, clientToken, owner: { ...made, business },
           project, milestone, payment };
}

describe('Open / withdraw dispute', () => {
  test('homeowner opens a dispute on a SUBMITTED milestone; status flips to DISPUTED', async () => {
    const { clientToken, project, milestone } = await setupSubmittedMilestone();

    const res = await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'WORK_LOW_QUALITY',
              details: 'The grout work is cracking and the tiles are uneven all over.' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('OPEN');
    expect(res.body.reason).toBe('WORK_LOW_QUALITY');

    const m = await db.milestone.findUnique({ where: { id: milestone.id } });
    expect(m.status).toBe('DISPUTED');
    expect(m.preDisputeStatus).toBe('SUBMITTED');
  });

  test('homeowner can dispute a FUNDED milestone too', async () => {
    const { clientToken, project, milestone } = await setupSubmittedMilestone({ status: 'FUNDED' });

    const res = await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'WORK_NOT_DONE', details: 'Contractor has not started.' });
    expect(res.status).toBe(201);

    const m = await db.milestone.findUnique({ where: { id: milestone.id } });
    expect(m.preDisputeStatus).toBe('FUNDED');
  });

  test('cannot dispute an APPROVED or REFUNDED milestone', async () => {
    const { clientToken, project, milestone } = await setupSubmittedMilestone();
    await db.milestone.update({ where: { id: milestone.id },
                                data: { status: 'APPROVED' } });

    const res = await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'OTHER', details: 'Trying after release.' });
    expect(res.status).toBe(409);
  });

  test('details must be at least 10 chars; reason must be a known value', async () => {
    const { clientToken, project, milestone } = await setupSubmittedMilestone();

    const tooShort = await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'OTHER', details: 'short' });
    expect(tooShort.status).toBe(400);

    const badReason = await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'GALAXY_BRAIN', details: 'Long enough text here.' });
    expect(badReason.status).toBe(400);
  });

  test('only one open dispute per milestone at a time', async () => {
    const { clientToken, project, milestone } = await setupSubmittedMilestone();

    const first = await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'OTHER', details: 'First open dispute.' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'OTHER', details: 'Trying to open a second.' });
    expect(second.status).toBe(409);
  });

  test('contractor cannot open a dispute', async () => {
    const { owner, project, milestone } = await setupSubmittedMilestone();

    const res = await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ reason: 'OTHER', details: 'Should not be allowed.' });
    expect(res.status).toBe(403);
  });

  test('homeowner withdraws their dispute; milestone restores to its prior status', async () => {
    const { clientToken, project, milestone } = await setupSubmittedMilestone();

    await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'OTHER', details: 'Changed my mind soon.' });

    const res = await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute/withdraw`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(200);
    expect(res.body.milestoneStatus).toBe('SUBMITTED');

    const m = await db.milestone.findUnique({ where: { id: milestone.id } });
    expect(m.status).toBe('SUBMITTED');
    expect(m.preDisputeStatus).toBeNull();

    const d = await db.dispute.findFirst({ where: { milestoneId: milestone.id } });
    expect(d.status).toBe('WITHDRAWN');
  });
});

describe('Approve / refund refuse to touch a DISPUTED milestone', () => {
  test('homeowner approve returns 409 while disputed', async () => {
    const { clientToken, project, milestone } = await setupSubmittedMilestone();
    await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'OTHER', details: 'Long enough reason.' });

    const res = await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/approve`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(409);
  });

  test('contractor refund returns 409 while disputed (admin must use the queue)', async () => {
    const { clientToken, owner, project, milestone } = await setupSubmittedMilestone();
    await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'OTHER', details: 'Long enough reason.' });

    const res = await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/refund`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(409);
  });

  test('auto-release sweep skips DISPUTED milestones even past the grace window', async () => {
    const { clientToken, project, milestone } = await setupSubmittedMilestone();
    await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'OTHER', details: 'Long enough reason here.' });

    // Run the sweep with "now" set 30 days in the future — would auto-release
    // a SUBMITTED milestone, but DISPUTED is skipped (sweep only looks for
    // status: SUBMITTED).
    const released = await autoReleaseStaleMilestones({
      now: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    expect(released).toBe(0);
    expect(stripe.createMilestoneTransfer).not.toHaveBeenCalled();

    const m = await db.milestone.findUnique({ where: { id: milestone.id } });
    expect(m.status).toBe('DISPUTED');
  });
});

describe('Admin queue + resolution', () => {
  test('non-admin cannot see the queue or resolve', async () => {
    const { clientToken } = await setupSubmittedMilestone();
    const queue = await request(app).get('/admin/disputes')
      .set('Authorization', `Bearer ${clientToken}`);
    expect(queue.status).toBe(403);
  });

  test('admin lists OPEN disputes by default and resolves with RELEASE', async () => {
    const { clientToken, project, milestone } = await setupSubmittedMilestone();
    const { token: adminToken } = await createAdmin();

    const filed = await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'WORK_LOW_QUALITY', details: 'Long enough detail text.' });

    const queue = await request(app).get('/admin/disputes')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(queue.status).toBe(200);
    expect(queue.body.length).toBe(1);
    expect(queue.body[0].milestone.project.business.companyName).toBe('Test Co');

    stripe.createMilestoneTransfer.mockResolvedValueOnce({ id: 'tr_resolved' });
    const resolve = await request(app)
      .post(`/admin/disputes/${filed.body.id}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'RELEASE', note: 'Work appears acceptable.' });
    expect(resolve.status).toBe(200);
    expect(stripe.createMilestoneTransfer).toHaveBeenCalledTimes(1);

    const m = await db.milestone.findUnique({ where: { id: milestone.id } });
    expect(m.status).toBe('APPROVED');
    expect(m.stripeTransferId).toBe('tr_resolved');

    const d = await db.dispute.findUnique({ where: { id: filed.body.id } });
    expect(d.status).toBe('RESOLVED_RELEASE');
    expect(d.resolutionNote).toBe('Work appears acceptable.');
  });

  test('admin resolves with REFUND, kicks off the Stripe refund', async () => {
    const { clientToken, project, milestone } = await setupSubmittedMilestone();
    const { token: adminToken } = await createAdmin();

    const filed = await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'WORK_NOT_DONE', details: 'They never showed up at all.' });

    stripe.createMilestoneRefund.mockResolvedValueOnce({ id: 're_resolved' });
    const resolve = await request(app)
      .post(`/admin/disputes/${filed.body.id}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'REFUND' });
    expect(resolve.status).toBe(200);
    expect(stripe.createMilestoneRefund).toHaveBeenCalledWith('pi_test');

    const d = await db.dispute.findUnique({ where: { id: filed.body.id } });
    expect(d.status).toBe('RESOLVED_REFUND');
  });

  test('resolving an already-resolved dispute is a 409', async () => {
    const { clientToken, project, milestone } = await setupSubmittedMilestone();
    const { token: adminToken } = await createAdmin();

    const filed = await request(app)
      .post(`/projects/${project.id}/milestones/${milestone.id}/dispute`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'OTHER', details: 'Long enough detail text.' });

    stripe.createMilestoneTransfer.mockResolvedValueOnce({ id: 'tr_x' });
    await request(app).post(`/admin/disputes/${filed.body.id}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`).send({ action: 'RELEASE' });

    const again = await request(app).post(`/admin/disputes/${filed.body.id}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`).send({ action: 'RELEASE' });
    expect(again.status).toBe(409);
  });
});
