const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createBusiness, tokenFor } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

const future = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

describe('Activity feed', () => {
  test('starting a conversation records a LEAD activity for the business', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, business } = await createBusiness();

    await request(app).post('/conversations').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, message: 'Hi there' }).expect(201);

    const res = await request(app).get('/activities').set('Authorization', `Bearer ${bizToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].type).toBe('LEAD');
    expect(res.body[0].data.conversationId).toBeTruthy();
    expect(res.body[0].readAt).toBeNull();
  });

  test('sending a message records a MESSAGE activity for the recipient', async () => {
    const { token: clientToken } = await createClient({ name: 'Dana' });
    const { token: bizToken, user: owner } = await createBusiness();
    const business = await db.business.findFirst({ where: { userId: owner.id } });

    const conv = await request(app).post('/conversations').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, message: 'First' });
    // Business replies → client should get a MESSAGE activity.
    await request(app).post(`/conversations/${conv.body.id}/messages`)
      .set('Authorization', `Bearer ${bizToken}`).send({ body: 'Thanks for reaching out' }).expect(201);

    const res = await request(app).get('/activities').set('Authorization', `Bearer ${clientToken}`);
    const messages = res.body.filter((a) => a.type === 'MESSAGE');
    expect(messages).toHaveLength(1);
    expect(messages[0].data.conversationId).toBe(conv.body.id);
  });

  test('requesting an appointment records an APPOINTMENT activity for the business', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, user: owner } = await createBusiness();
    const business = await db.business.findFirst({ where: { userId: owner.id } });

    const appt = await request(app).post('/appointments').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: future() });

    const res = await request(app).get('/activities').set('Authorization', `Bearer ${bizToken}`);
    const appts = res.body.filter((a) => a.type === 'APPOINTMENT');
    expect(appts).toHaveLength(1);
    expect(appts[0].data.appointmentId).toBe(appt.body.id);
  });

  test('confirming an appointment records an APPOINTMENT activity for the client', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, user: owner } = await createBusiness();
    const business = await db.business.findFirst({ where: { userId: owner.id } });

    const appt = await request(app).post('/appointments').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: future() });
    await request(app).patch(`/appointments/${appt.body.id}`)
      .set('Authorization', `Bearer ${bizToken}`).send({ status: 'CONFIRMED' }).expect(200);

    const res = await request(app).get('/activities').set('Authorization', `Bearer ${clientToken}`);
    const appts = res.body.filter((a) => a.type === 'APPOINTMENT');
    expect(appts).toHaveLength(1);
    expect(appts[0].data.appointmentId).toBe(appt.body.id);
  });

  test('the feed is scoped to the recipient and newest-first', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, user: owner } = await createBusiness();
    const business = await db.business.findFirst({ where: { userId: owner.id } });

    await request(app).post('/conversations').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, message: 'Hi' }).expect(201);
    await request(app).post('/appointments').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: future() }).expect(201);

    // The client (sender) has no activities; the business has two.
    const clientFeed = await request(app).get('/activities').set('Authorization', `Bearer ${clientToken}`);
    expect(clientFeed.body).toHaveLength(0);

    const bizFeed = await request(app).get('/activities').set('Authorization', `Bearer ${bizToken}`);
    expect(bizFeed.body).toHaveLength(2);
    expect(new Date(bizFeed.body[0].createdAt) >= new Date(bizFeed.body[1].createdAt)).toBe(true);
  });

  test('unread count reflects new and read state', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, user: owner } = await createBusiness();
    const business = await db.business.findFirst({ where: { userId: owner.id } });

    await request(app).post('/conversations').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, message: 'Hi' }).expect(201);

    let unread = await request(app).get('/activities/unread').set('Authorization', `Bearer ${bizToken}`);
    expect(unread.body.count).toBe(1);

    const marked = await request(app).post('/activities/read').set('Authorization', `Bearer ${bizToken}`);
    expect(marked.body.updated).toBe(1);

    unread = await request(app).get('/activities/unread').set('Authorization', `Bearer ${bizToken}`);
    expect(unread.body.count).toBe(0);
  });

  test('marking read only affects the calling user', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, user: owner } = await createBusiness();
    const business = await db.business.findFirst({ where: { userId: owner.id } });

    const conv = await request(app).post('/conversations').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, message: 'Hi' });
    await request(app).post(`/conversations/${conv.body.id}/messages`)
      .set('Authorization', `Bearer ${bizToken}`).send({ body: 'Reply' });

    // Client reads their feed; business's unread should be untouched.
    await request(app).post('/activities/read').set('Authorization', `Bearer ${clientToken}`).expect(200);

    const bizUnread = await request(app).get('/activities/unread').set('Authorization', `Bearer ${bizToken}`);
    expect(bizUnread.body.count).toBe(1);
  });

  test('feed entries carry a normalized deep-link', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, user: owner } = await createBusiness();
    const business = await db.business.findFirst({ where: { userId: owner.id } });

    // A conversation lead (business) and an appointment request (business).
    const conv = await request(app).post('/conversations').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, message: 'Hi' });
    const appt = await request(app).post('/appointments').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: future() });

    const res = await request(app).get('/activities').set('Authorization', `Bearer ${bizToken}`);
    const lead = res.body.find((a) => a.type === 'LEAD');
    const apptAct = res.body.find((a) => a.type === 'APPOINTMENT');

    expect(lead.link).toEqual({ screen: 'conversation', id: conv.body.id });
    expect(apptAct.link).toEqual({ screen: 'appointment', id: appt.body.id });
  });

  test('a quote-request lead deep-links to the quote', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, business } = await createBusiness();

    const quote = await request(app).post('/quotes').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, description: 'Kitchen' });

    const res = await request(app).get('/activities').set('Authorization', `Bearer ${bizToken}`);
    const lead = res.body.find((a) => a.type === 'LEAD');
    expect(lead.link).toEqual({ screen: 'quote', id: quote.body.id });
  });

  test('a saved-search match deep-links to the business', async () => {
    const { token: clientToken } = await createClient();
    // Save a search, then create a matching business through the API route
    // (that's the path that fires the new-contractor alert).
    await request(app).post('/saved-searches').set('Authorization', `Bearer ${clientToken}`)
      .send({ specialty: 'Kitchen' }).expect(201);

    const owner = await db.user.create({
      data: { email: `match_${Date.now()}@biz.com`, passwordHash: 'x', name: 'Owner', role: 'BUSINESS' },
    });
    const created = await request(app).post('/businesses')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({
        companyName: 'Bright Kitchens', description: 'We remodel kitchens.',
        city: 'Austin', state: 'TX', zipCode: '78701', specialties: ['Kitchen'],
      });
    expect(created.status).toBe(201);

    const res = await request(app).get('/activities').set('Authorization', `Bearer ${clientToken}`);
    const match = res.body.find((a) => a.type === 'SAVED_SEARCH');
    expect(match.link).toEqual({ screen: 'business', id: created.body.id });
  });

  test('requires authentication', async () => {
    await request(app).get('/activities').expect(401);
    await request(app).get('/activities/unread').expect(401);
    await request(app).post('/activities/read').expect(401);
  });

  test('deleting a user cascades to their activities', async () => {
    const { user } = await createClient();
    await db.activity.create({
      data: { userId: user.id, type: 'MESSAGE', title: 'Hi', body: 'There' },
    });
    expect(await db.activity.count({ where: { userId: user.id } })).toBe(1);

    await db.user.delete({ where: { id: user.id } });

    expect(await db.activity.count({ where: { userId: user.id } })).toBe(0);
  });
});
