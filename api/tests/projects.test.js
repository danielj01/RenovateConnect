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
});
