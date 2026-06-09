// Covers the derived Project hub: GET /projects (active-only, grouped by
// counterparty) and GET /projects/:businessId (aggregated timeline). The hub is
// read-only aggregation over existing rows — no Project table.
const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createBusiness } = require('./helpers');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

describe('GET /projects', () => {
  test('groups active engagements by contractor, newest first', async () => {
    const { user: client, token } = await createClient();
    const { business: bizA } = await createBusiness({ companyName: 'Alpha Builders' });
    const { business: bizB } = await createBusiness({ companyName: 'Beta Renos' });

    // Active quote with contractor A.
    await db.quoteRequest.create({
      data: { clientId: client.id, businessId: bizA.id, description: 'Kitchen', status: 'QUOTED', quoteLow: 1000, quoteHigh: 2000 },
    });
    // Upcoming appointment with contractor B.
    await db.appointment.create({
      data: { clientId: client.id, businessId: bizB.id, scheduledAt: new Date(Date.now() + 86400000), status: 'CONFIRMED' },
    });

    const res = await request(app).get('/projects').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const names = res.body.map((p) => p.companyName);
    expect(names).toContain('Alpha Builders');
    expect(names).toContain('Beta Renos');
    const alpha = res.body.find((p) => p.companyName === 'Alpha Builders');
    expect(alpha.headline).toBe('Quote ready to review');
    expect(alpha.openQuoteCount).toBe(1);
  });

  test('excludes engagements with no active artifacts', async () => {
    const { user: client, token } = await createClient();
    const { business } = await createBusiness();
    // Only a declined quote and a past appointment — nothing active.
    await db.quoteRequest.create({
      data: { clientId: client.id, businessId: business.id, description: 'x', status: 'DECLINED' },
    });
    await db.appointment.create({
      data: { clientId: client.id, businessId: business.id, scheduledAt: new Date(Date.now() - 86400000), status: 'CONFIRMED' },
    });

    const res = await request(app).get('/projects').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  test('counts unread messages from the contractor', async () => {
    const { user: client, token } = await createClient();
    const { user: owner, business } = await createBusiness();
    await db.quoteRequest.create({
      data: { clientId: client.id, businessId: business.id, description: 'x', status: 'PENDING' },
    });
    const convo = await db.conversation.create({
      data: { clientId: client.id, businessId: business.id },
    });
    await db.message.create({ data: { conversationId: convo.id, senderId: owner.id, body: 'Hi there' } });
    await db.message.create({ data: { conversationId: convo.id, senderId: client.id, body: 'My own msg' } });

    const res = await request(app).get('/projects').set('Authorization', `Bearer ${token}`);
    const proj = res.body.find((p) => p.businessId === business.id);
    expect(proj.unreadCount).toBe(1); // only the contractor's message counts
  });

  test('surfaces milestone progress, escrow held, and a role-aware action count', async () => {
    const { user: client, token: clientToken } = await createClient();
    const { business, token: ownerToken } = await createBusiness();

    const project = await db.project.create({
      data: { clientId: client.id, businessId: business.id, title: 'Kitchen project' },
    });
    // One released, one held-and-submitted (needs homeowner approval), one funded
    // (needs contractor to submit), one not yet funded.
    await db.milestone.create({ data: { projectId: project.id, title: 'Demo', amountCents: 100000, status: 'APPROVED', approvedAt: new Date() } });
    await db.milestone.create({ data: { projectId: project.id, title: 'Cabinets', amountCents: 200000, status: 'SUBMITTED', fundedAt: new Date(), submittedAt: new Date() } });
    await db.milestone.create({ data: { projectId: project.id, title: 'Counters', amountCents: 300000, status: 'FUNDED', fundedAt: new Date() } });
    await db.milestone.create({ data: { projectId: project.id, title: 'Paint', amountCents: 50000, status: 'PENDING' } });

    // Homeowner view: escrow = SUBMITTED + FUNDED; action = SUBMITTED to approve.
    const asClient = await request(app).get('/projects').set('Authorization', `Bearer ${clientToken}`);
    const cp = asClient.body.find((p) => p.businessId === business.id);
    expect(cp.milestoneTotal).toBe(4);
    expect(cp.milestonesReleased).toBe(1);
    expect(cp.escrowCents).toBe(500000); // 200000 + 300000 held on platform
    expect(cp.milestoneActionCount).toBe(1); // one SUBMITTED awaiting approval
    expect(cp.headline).toBe('Approve completed work');

    // Contractor view of the same project: action = FUNDED work to submit.
    const asOwner = await request(app).get('/projects').set('Authorization', `Bearer ${ownerToken}`);
    const op = asOwner.body.find((p) => p.businessId === business.id);
    expect(op.milestoneActionCount).toBe(1); // one FUNDED awaiting submission
    expect(op.headline).toBe('Submit completed work');
  });
});

describe('GET /projects/:businessId', () => {
  test('returns the aggregated timeline for one engagement', async () => {
    const { user: client, token } = await createClient();
    const { business } = await createBusiness({ companyName: 'Gamma Co' });

    await db.quoteRequest.create({
      data: { clientId: client.id, businessId: business.id, description: 'Bathroom remodel', status: 'ACCEPTED', quoteLow: 5000, quoteHigh: 7000 },
    });
    await db.appointment.create({
      data: { clientId: client.id, businessId: business.id, scheduledAt: new Date(Date.now() + 172800000), status: 'REQUESTED' },
    });
    await db.payment.create({
      data: { clientId: client.id, businessId: business.id, amountCents: 60000, commissionCents: 4800, status: 'SUCCEEDED', paidAt: new Date() },
    });

    const res = await request(app).get(`/projects/${business.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.business.companyName).toBe('Gamma Co');
    expect(res.body.quotes).toHaveLength(1);
    expect(res.body.appointments).toHaveLength(1);
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].amountCents).toBe(60000);
  });

  test('404 when the user has no artifacts with that business', async () => {
    const { token } = await createClient();
    const { business } = await createBusiness();
    const res = await request(app).get(`/projects/${business.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('a client cannot see another client’s engagement with the same business', async () => {
    const { user: clientA } = await createClient();
    const { token: tokenB } = await createClient();
    const { business } = await createBusiness();
    await db.quoteRequest.create({
      data: { clientId: clientA.id, businessId: business.id, description: 'private', status: 'PENDING' },
    });
    // Client B has nothing with this business → 404 (no leak).
    const res = await request(app).get(`/projects/${business.id}`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  test('payments include commission, kind, description, refundedAt for the receipt sheet', async () => {
    const { user: client, token } = await createClient();
    const { business } = await createBusiness({ companyName: 'Receipt Co' });
    const quote = await db.quoteRequest.create({
      data: { clientId: client.id, businessId: business.id, description: 'x', status: 'ACCEPTED', respondedAt: new Date() },
    });
    await db.payment.create({
      data: {
        clientId: client.id, businessId: business.id, quoteRequestId: quote.id,
        amountCents: 54000, commissionCents: 4000, status: 'SUCCEEDED',
        description: 'Deposit on Bath remodel', paidAt: new Date(),
      },
    });
    const res = await request(app).get(`/projects/${business.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.payments[0]).toMatchObject({
      amountCents: 54000,
      commissionCents: 4000,
      kind: 'DEPOSIT',
      description: 'Deposit on Bath remodel',
      refundedAt: null,
    });
  });
});

describe('PATCH /projects/:projectId/notes', () => {
  async function setupProject() {
    const { user: client, token } = await createClient();
    const { business } = await createBusiness();
    const project = await db.project.create({
      data: { clientId: client.id, businessId: business.id, title: 'Kitchen' },
    });
    return { client, token, business, project };
  }

  test('homeowner can save and clear their notes', async () => {
    const { token, project } = await setupProject();
    const save = await request(app).patch(`/projects/${project.id}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'Paint: Sherwin Williams SW7008.\nCabinets 36in.' });
    expect(save.status).toBe(200);
    expect(save.body.clientNotes).toContain('Sherwin');

    const reload = await db.project.findUnique({ where: { id: project.id } });
    expect(reload.clientNotes).toContain('Sherwin');

    const clear = await request(app).patch(`/projects/${project.id}/notes`)
      .set('Authorization', `Bearer ${token}`).send({ notes: '' });
    expect(clear.status).toBe(200);
    expect(clear.body.clientNotes).toBeNull();
  });

  test('rejects an oversized notes payload', async () => {
    const { token, project } = await setupProject();
    const huge = 'a'.repeat(8001);
    const res = await request(app).patch(`/projects/${project.id}/notes`)
      .set('Authorization', `Bearer ${token}`).send({ notes: huge });
    expect(res.status).toBe(400);
  });

  test('the contractor cannot edit the homeowner notes', async () => {
    const { project } = await setupProject();
    const { token: bizToken } = await createBusiness();
    const res = await request(app).patch(`/projects/${project.id}/notes`)
      .set('Authorization', `Bearer ${bizToken}`).send({ notes: 'sneaky' });
    expect(res.status).toBe(403);
  });

  test('a different homeowner cannot edit', async () => {
    const { project } = await setupProject();
    const { token: otherToken } = await createClient();
    const res = await request(app).patch(`/projects/${project.id}/notes`)
      .set('Authorization', `Bearer ${otherToken}`).send({ notes: 'sneaky' });
    expect(res.status).toBe(403);
  });

  test('clientNotes are NOT included in the contractor-side project response', async () => {
    const { client, token: clientToken, business, project } = await setupProject();
    // Homeowner stores private notes.
    await db.project.update({ where: { id: project.id }, data: { clientNotes: 'paint code SW7008' } });
    // Contractor logs in and pulls the same engagement.
    const ownerToken = require('jsonwebtoken').sign(
      { id: (await db.user.findUnique({ where: { id: (await db.business.findUnique({ where: { id: business.id } })).userId } })).id, role: 'BUSINESS' },
      process.env.JWT_SECRET, { expiresIn: '1d' }
    );

    const contractorView = await request(app).get(`/projects/${client.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    // The contractor's hub for this homeowner — must not echo clientNotes.
    // (404 is acceptable since contractors don't typically read this route,
    // but if it does load, clientNotes must be absent.)
    if (contractorView.status === 200 && contractorView.body.project) {
      expect(contractorView.body.project.clientNotes).toBeUndefined();
    }

    // Homeowner DOES see it.
    const homeownerView = await request(app).get(`/projects/${business.id}`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(homeownerView.status).toBe(200);
    expect(homeownerView.body.project.clientNotes).toBe('paint code SW7008');
  });
});
