const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createBusiness } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

describe('Saved contractors (favorites)', () => {
  test('a homeowner can save a contractor', async () => {
    const { token, user } = await createClient();
    const { business } = await createBusiness();

    const res = await request(app)
      .post(`/favorites/${business.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(201);
    expect(res.body.businessId).toBe(business.id);

    const stored = await db.favorite.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0].businessId).toBe(business.id);
  });

  test('saving the same contractor twice is idempotent', async () => {
    const { token, user } = await createClient();
    const { business } = await createBusiness();

    await request(app).post(`/favorites/${business.id}`).set('Authorization', `Bearer ${token}`).expect(201);
    await request(app).post(`/favorites/${business.id}`).set('Authorization', `Bearer ${token}`).expect(201);

    const stored = await db.favorite.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
  });

  test('saving a non-existent business returns 404', async () => {
    const { token } = await createClient();
    const res = await request(app)
      .post('/favorites/does-not-exist')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('GET /favorites returns the saved businesses with reviews', async () => {
    const { token } = await createClient();
    const a = await createBusiness({ email: 'a@biz.com', companyName: 'Alpha Build' });
    const b = await createBusiness({ email: 'b@biz.com', companyName: 'Beta Renovations' });
    await db.review.create({ data: { businessId: a.business.id, rating: 5, authorName: 'Jo' } });

    await request(app).post(`/favorites/${a.business.id}`).set('Authorization', `Bearer ${token}`).expect(201);
    await request(app).post(`/favorites/${b.business.id}`).set('Authorization', `Bearer ${token}`).expect(201);

    const res = await request(app).get('/favorites').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Most-recently saved first.
    expect(res.body[0].id).toBe(b.business.id);
    const alpha = res.body.find((x) => x.id === a.business.id);
    expect(alpha.reviews).toHaveLength(1);
  });

  test('favorites are scoped to the signed-in user', async () => {
    const me = await createClient({ email: 'me@test.com' });
    const other = await createClient({ email: 'other@test.com' });
    const { business } = await createBusiness();

    await request(app).post(`/favorites/${business.id}`).set('Authorization', `Bearer ${other.token}`).expect(201);

    const res = await request(app).get('/favorites').set('Authorization', `Bearer ${me.token}`);
    expect(res.body).toHaveLength(0);
  });

  test('a homeowner can unsave a contractor', async () => {
    const { token, user } = await createClient();
    const { business } = await createBusiness();

    await request(app).post(`/favorites/${business.id}`).set('Authorization', `Bearer ${token}`).expect(201);
    await request(app).delete(`/favorites/${business.id}`).set('Authorization', `Bearer ${token}`).expect(204);

    const stored = await db.favorite.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(0);
  });

  test('unsaving a contractor that was never saved is a no-op 204', async () => {
    const { token } = await createClient();
    const { business } = await createBusiness();
    await request(app).delete(`/favorites/${business.id}`).set('Authorization', `Bearer ${token}`).expect(204);
  });

  test('requires authentication', async () => {
    const { business } = await createBusiness();
    await request(app).get('/favorites').expect(401);
    await request(app).post(`/favorites/${business.id}`).expect(401);
  });

  test('businesses cannot use the homeowner favorites endpoints', async () => {
    const { token } = await createBusiness();
    const other = await createBusiness({ email: 'other-biz@test.com' });
    await request(app).get('/favorites').set('Authorization', `Bearer ${token}`).expect(403);
    await request(app).post(`/favorites/${other.business.id}`).set('Authorization', `Bearer ${token}`).expect(403);
  });

  test('removing a business cascades to its favorites', async () => {
    const { token, user } = await createClient();
    const { business } = await createBusiness();
    await request(app).post(`/favorites/${business.id}`).set('Authorization', `Bearer ${token}`).expect(201);

    await db.business.delete({ where: { id: business.id } });

    const stored = await db.favorite.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(0);
  });
});
