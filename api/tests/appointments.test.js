const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createBusiness } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

// A fixed future time so assertions don't drift.
const future = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

describe('Appointments', () => {
  test('a homeowner can request an appointment', async () => {
    const { token, user } = await createClient();
    const { business } = await createBusiness();

    const res = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: business.id, scheduledAt: future(), note: 'Kitchen remodel walkthrough' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('REQUESTED');
    expect(res.body.clientId).toBe(user.id);
    expect(res.body.businessId).toBe(business.id);
    expect(res.body.durationMin).toBe(60); // default
    expect(res.body.business.companyName).toBe('Test Co');
    expect(res.body.client.name).toBe('Test Client');
  });

  test('a custom duration is respected', async () => {
    const { token } = await createClient();
    const { business } = await createBusiness();

    const res = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: business.id, scheduledAt: future(), durationMin: 120 });

    expect(res.status).toBe(201);
    expect(res.body.durationMin).toBe(120);
  });

  test('requesting against a non-existent business returns 404', async () => {
    const { token } = await createClient();
    const res = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'nope', scheduledAt: future() });
    expect(res.status).toBe(404);
  });

  test('a business cannot request an appointment', async () => {
    const { token } = await createBusiness();
    const other = await createBusiness({ email: 'other@biz.com' });
    const res = await request(app)
      .post('/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: other.business.id, scheduledAt: future() });
    expect(res.status).toBe(403);
  });

  test('a client sees only their own appointments, soonest first', async () => {
    const me = await createClient({ email: 'me@test.com' });
    const other = await createClient({ email: 'other@test.com' });
    const { business } = await createBusiness();

    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const later = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString();
    await request(app).post('/appointments').set('Authorization', `Bearer ${me.token}`)
      .send({ businessId: business.id, scheduledAt: later }).expect(201);
    await request(app).post('/appointments').set('Authorization', `Bearer ${me.token}`)
      .send({ businessId: business.id, scheduledAt: soon }).expect(201);
    await request(app).post('/appointments').set('Authorization', `Bearer ${other.token}`)
      .send({ businessId: business.id, scheduledAt: soon }).expect(201);

    const res = await request(app).get('/appointments').set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(new Date(res.body[0].scheduledAt) < new Date(res.body[1].scheduledAt)).toBe(true);
  });

  test('a business sees appointments booked with it', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, business } = await createBusiness();
    await request(app).post('/appointments').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: future() }).expect(201);

    const res = await request(app).get('/appointments').set('Authorization', `Bearer ${bizToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].client.name).toBe('Test Client');
  });

  test('the business can confirm a request', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, business } = await createBusiness();
    const created = await request(app).post('/appointments').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: future() });

    const res = await request(app)
      .patch(`/appointments/${created.body.id}`)
      .set('Authorization', `Bearer ${bizToken}`)
      .send({ status: 'CONFIRMED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CONFIRMED');
  });

  test('the business can decline a request', async () => {
    const { token: clientToken } = await createClient();
    const { token: bizToken, business } = await createBusiness();
    const created = await request(app).post('/appointments').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: future() });

    const res = await request(app)
      .patch(`/appointments/${created.body.id}`)
      .set('Authorization', `Bearer ${bizToken}`)
      .send({ status: 'DECLINED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DECLINED');
  });

  test('the client can cancel their own appointment', async () => {
    const { token: clientToken } = await createClient();
    const { business } = await createBusiness();
    const created = await request(app).post('/appointments').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: future() });

    const res = await request(app)
      .patch(`/appointments/${created.body.id}`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ status: 'CANCELLED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
  });

  test('a client cannot confirm their own appointment', async () => {
    const { token: clientToken } = await createClient();
    const { business } = await createBusiness();
    const created = await request(app).post('/appointments').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: future() });

    const res = await request(app)
      .patch(`/appointments/${created.body.id}`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ status: 'CONFIRMED' });

    expect(res.status).toBe(403);
  });

  test('an unrelated user cannot update an appointment', async () => {
    const { token: clientToken } = await createClient();
    const stranger = await createClient({ email: 'stranger@test.com' });
    const { business } = await createBusiness();
    const created = await request(app).post('/appointments').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: future() });

    const res = await request(app)
      .patch(`/appointments/${created.body.id}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ status: 'CANCELLED' });

    expect(res.status).toBe(403);
  });

  test('updating a non-existent appointment returns 404', async () => {
    const { token } = await createBusiness();
    const res = await request(app)
      .patch('/appointments/nope')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CONFIRMED' });
    expect(res.status).toBe(404);
  });

  test('requires authentication', async () => {
    await request(app).get('/appointments').expect(401);
    await request(app).post('/appointments').send({ businessId: 'x', scheduledAt: future() }).expect(401);
  });

  test('deleting a business cascades to its appointments', async () => {
    const { token: clientToken } = await createClient();
    const { business } = await createBusiness();
    await request(app).post('/appointments').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: future() }).expect(201);

    await db.business.delete({ where: { id: business.id } });

    const stored = await db.appointment.findMany({ where: { businessId: business.id } });
    expect(stored).toHaveLength(0);
  });
});
