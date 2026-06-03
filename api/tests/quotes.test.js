const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createBusiness, createAdmin } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

// Create a PENDING quote request from a client to a business; returns its body.
async function createQuote(clientToken, businessId, overrides = {}) {
  const res = await request(app).post('/quotes')
    .set('Authorization', `Bearer ${clientToken}`)
    .send({ businessId, description: 'Full kitchen remodel', category: 'Kitchen', ...overrides });
  return res;
}

describe('Quote requests — creation', () => {
  test('a homeowner can submit a structured quote request', async () => {
    const { token, user } = await createClient();
    const { business } = await createBusiness();

    const res = await request(app).post('/quotes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessId: business.id,
        description: 'Gut and rebuild a 200 sq ft kitchen',
        category: 'Kitchen',
        budgetMin: 20000,
        budgetMax: 35000,
        timeline: 'Within 2 months',
        imageUrls: ['https://img/1.jpg', 'https://img/2.jpg'],
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.clientId).toBe(user.id);
    expect(res.body.businessId).toBe(business.id);
    expect(res.body.budgetMin).toBe(20000);
    expect(res.body.imageUrls).toHaveLength(2);
    expect(res.body.business.companyName).toBe('Test Co');
    expect(res.body.client.name).toBe('Test Client');
  });

  test('creating a request notifies the contractor (LEAD activity)', async () => {
    const { token } = await createClient();
    const { business, user: owner } = await createBusiness();
    await createQuote(token, business.id);

    const acts = await db.activity.findMany({ where: { userId: owner.id } });
    expect(acts).toHaveLength(1);
    expect(acts[0].type).toBe('LEAD');
    expect(acts[0].data.quoteId).toBeTruthy();
  });

  test('description is required (validation → 400)', async () => {
    const { token } = await createClient();
    const { business } = await createBusiness();
    const res = await request(app).post('/quotes')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: business.id, description: '' });
    expect(res.status).toBe(400);
  });

  test('a request against a non-existent business returns 404', async () => {
    const { token } = await createClient();
    const res = await createQuote(token, 'nope');
    expect(res.status).toBe(404);
  });

  test('a business cannot submit a quote request', async () => {
    const { token } = await createBusiness();
    const other = await createBusiness({ email: 'other@biz.com' });
    const res = await createQuote(token, other.business.id);
    expect(res.status).toBe(403);
  });

  test('creation requires authentication', async () => {
    const { business } = await createBusiness();
    await request(app).post('/quotes').send({ businessId: business.id, description: 'x' }).expect(401);
  });
});

describe('Quote requests — listing & access', () => {
  test('a client sees only their own requests, newest first', async () => {
    const me = await createClient({ email: 'me@test.com' });
    const other = await createClient({ email: 'other@test.com' });
    const { business } = await createBusiness();

    await createQuote(me.token, business.id, { description: 'First' });
    await createQuote(me.token, business.id, { description: 'Second' });
    await createQuote(other.token, business.id, { description: 'Theirs' });

    const res = await request(app).get('/quotes').set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].description).toBe('Second'); // newest first
  });

  test('a business sees requests addressed to it', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, business } = await createBusiness();
    await createQuote(clientToken, business.id);

    const res = await request(app).get('/quotes').set('Authorization', `Bearer ${bizToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].client.name).toBe('Test Client');
  });

  test('either party can fetch a single quote; a stranger cannot', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, business } = await createBusiness();
    const stranger = await createClient({ email: 'stranger@test.com' });
    const created = await createQuote(clientToken, business.id);

    await request(app).get(`/quotes/${created.body.id}`).set('Authorization', `Bearer ${clientToken}`).expect(200);
    await request(app).get(`/quotes/${created.body.id}`).set('Authorization', `Bearer ${bizToken}`).expect(200);
    await request(app).get(`/quotes/${created.body.id}`).set('Authorization', `Bearer ${stranger.token}`).expect(403);
  });

  test('fetching a missing quote returns 404', async () => {
    const { token } = await createClient();
    await request(app).get('/quotes/nope').set('Authorization', `Bearer ${token}`).expect(404);
  });
});

describe('Quote requests — lifecycle', () => {
  test('the contractor can send a quote and the homeowner is notified', async () => {
    const { token: clientToken, user: client } = await createClient();
    const { token: bizToken, business } = await createBusiness();
    const created = await createQuote(clientToken, business.id);

    const res = await request(app).patch(`/quotes/${created.body.id}`)
      .set('Authorization', `Bearer ${bizToken}`)
      .send({ status: 'QUOTED', quoteLow: 18000, quoteHigh: 24000, responseNote: 'Includes demo and haul-away.' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('QUOTED');
    expect(res.body.quoteLow).toBe(18000);
    expect(res.body.quoteHigh).toBe(24000);
    expect(res.body.responseNote).toBe('Includes demo and haul-away.');
    expect(res.body.respondedAt).toBeTruthy();

    const acts = await db.activity.findMany({ where: { userId: client.id } });
    expect(acts.some((a) => a.type === 'LEAD')).toBe(true);
  });

  test('quoting without prices is rejected (422)', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, business } = await createBusiness();
    const created = await createQuote(clientToken, business.id);

    const res = await request(app).patch(`/quotes/${created.body.id}`)
      .set('Authorization', `Bearer ${bizToken}`)
      .send({ status: 'QUOTED' });
    expect(res.status).toBe(422);
  });

  test('a high price below the low price is rejected (422)', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, business } = await createBusiness();
    const created = await createQuote(clientToken, business.id);

    const res = await request(app).patch(`/quotes/${created.body.id}`)
      .set('Authorization', `Bearer ${bizToken}`)
      .send({ status: 'QUOTED', quoteLow: 5000, quoteHigh: 1000 });
    expect(res.status).toBe(422);
  });

  test('the contractor can decline a request', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, business } = await createBusiness();
    const created = await createQuote(clientToken, business.id);

    const res = await request(app).patch(`/quotes/${created.body.id}`)
      .set('Authorization', `Bearer ${bizToken}`)
      .send({ status: 'DECLINED', responseNote: 'Booked solid this quarter.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DECLINED');
  });

  test('a homeowner cannot send a quote', async () => {
    const { token: clientToken } = await createClient();
    const { business } = await createBusiness();
    const created = await createQuote(clientToken, business.id);

    const res = await request(app).patch(`/quotes/${created.body.id}`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ status: 'QUOTED', quoteLow: 1, quoteHigh: 2 });
    expect(res.status).toBe(403);
  });

  test('the homeowner can accept a quote', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, business, user: owner } = await createBusiness();
    const created = await createQuote(clientToken, business.id);
    await request(app).patch(`/quotes/${created.body.id}`)
      .set('Authorization', `Bearer ${bizToken}`)
      .send({ status: 'QUOTED', quoteLow: 100, quoteHigh: 200 }).expect(200);

    const res = await request(app).patch(`/quotes/${created.body.id}`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ status: 'ACCEPTED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACCEPTED');

    const acts = await db.activity.findMany({ where: { userId: owner.id } });
    // One for the original request, one for the acceptance.
    expect(acts.filter((a) => a.type === 'LEAD').length).toBe(2);
  });

  test('accepting before a quote exists is rejected (409)', async () => {
    const { token: clientToken } = await createClient();
    const { business } = await createBusiness();
    const created = await createQuote(clientToken, business.id);

    const res = await request(app).patch(`/quotes/${created.body.id}`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ status: 'ACCEPTED' });
    expect(res.status).toBe(409);
  });

  test('the homeowner can withdraw a pending request', async () => {
    const { token: clientToken } = await createClient();
    const { business } = await createBusiness();
    const created = await createQuote(clientToken, business.id);

    const res = await request(app).patch(`/quotes/${created.body.id}`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ status: 'WITHDRAWN' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('WITHDRAWN');
  });

  test('a closed quote cannot be transitioned again (409)', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, business } = await createBusiness();
    const created = await createQuote(clientToken, business.id);
    await request(app).patch(`/quotes/${created.body.id}`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ status: 'WITHDRAWN' }).expect(200);

    const res = await request(app).patch(`/quotes/${created.body.id}`)
      .set('Authorization', `Bearer ${bizToken}`)
      .send({ status: 'QUOTED', quoteLow: 1, quoteHigh: 2 });
    expect(res.status).toBe(409);
  });

  test('a stranger cannot transition a quote', async () => {
    const { token: clientToken } = await createClient();
    const { business } = await createBusiness();
    const stranger = await createBusiness({ email: 'stranger@biz.com' });
    const created = await createQuote(clientToken, business.id);

    const res = await request(app).patch(`/quotes/${created.body.id}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ status: 'DECLINED' });
    expect(res.status).toBe(403);
  });

  test('an admin can respond on behalf of the contractor', async () => {
    const { token: clientToken } = await createClient();
    const { business } = await createBusiness();
    const { token: adminToken } = await createAdmin();
    const created = await createQuote(clientToken, business.id);

    const res = await request(app).patch(`/quotes/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'QUOTED', quoteLow: 1000, quoteHigh: 2000 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('QUOTED');
  });

  test('deleting a business cascades to its quote requests', async () => {
    const { token: clientToken } = await createClient();
    const { business } = await createBusiness();
    await createQuote(clientToken, business.id);

    await db.business.delete({ where: { id: business.id } });
    const stored = await db.quoteRequest.findMany({ where: { businessId: business.id } });
    expect(stored).toHaveLength(0);
  });
});
